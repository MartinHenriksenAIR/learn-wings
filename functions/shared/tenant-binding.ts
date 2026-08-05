import type { InvocationContext } from '@azure/functions';
import { query, queryOne, withTransaction } from './db';
import { lockSeatUsage, isAtSeatLimit } from './seats';

/**
 * Org ↔ Entra tenant binding for SSO auto-join (#353).
 *
 * The platform matches a signing-in user to their org by their VERIFIED Entra
 * tenant id (the `tid` claim of the server-validated token — see shared/auth.ts;
 * never client-supplied). An org is bound to a tenant so members of that tenant
 * self-onboard as learners with no invite.
 *
 * Binding model (decision "learn from the first admin"): the binding is
 * auto-seeded from the first org_admin's token on invite conversion
 * (seedTenantBinding), guarded against the shared consumer tenant, and a
 * platform admin can override it (functions/organization-update).
 */

/**
 * The well-known "personal Microsoft accounts" tenant. Under the app's
 * multi-tenant `common` authority (src/lib/msal-config.ts), EVERY consumer/
 * personal MSA (outlook.com, hotmail.com, live.com, …) authenticates under this
 * single shared tenant id. It must NEVER become an org's binding: doing so would
 * auto-join every personal Microsoft account on earth into that org — a critical
 * org-isolation breach. Both auto-seed and the platform-admin override refuse it.
 * See https://learn.microsoft.com/entra/identity-platform/id-token-claims-reference (tid).
 */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * True for a tenant id that may bind an org: present, non-blank, and NOT the
 * shared consumer tenant. The single gate every binding write goes through.
 */
export function isBindableTenant(tid: string | null | undefined): boolean {
  return typeof tid === 'string' && tid.trim().length > 0 && tid !== CONSUMER_TENANT_ID;
}

/** The email's domain (lowercased), or null — the human-friendly binding label. */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Auto-seed an org's tenant binding from the first org_admin's verified token
 * (#353). Best-effort and idempotent: sets organizations.entra_tid +
 * entra_tid_label ONLY when the org is currently unbound AND no other org
 * already holds this tid (first-bound-wins collision rule). The label is the
 * admin's email domain — a cosmetic hint a platform admin can correct; the tid
 * stays the source of truth for matching.
 *
 * Guards:
 *   • refuses the shared consumer/MSA tenant (isBindableTenant).
 *   • the WHERE-clause NOT EXISTS makes a collision a no-op skip (logged), so it
 *     never trips the UNIQUE constraint into a thrown 23505. Runs on its OWN
 *     pooled connection (not a caller transaction), so even the backstop
 *     constraint firing could not roll back the invite conversion that triggered
 *     it. Any failure is swallowed — seeding must never break login/accept, and
 *     it retries on the admin's next login.
 */
export async function seedTenantBinding(
  orgId: string,
  tid: string,
  email: string,
  context: InvocationContext,
): Promise<void> {
  if (!isBindableTenant(tid)) return;
  const label = emailDomain(email);
  try {
    const seeded = await query<{ id: string }>(
      `UPDATE organizations
          SET entra_tid = $1, entra_tid_label = $2
        WHERE id = $3
          AND entra_tid IS NULL
          AND NOT EXISTS (SELECT 1 FROM organizations o2 WHERE o2.entra_tid = $1)
        RETURNING id`,
      [tid, label, orgId],
    );
    if (seeded.length > 0) return; // bound

    // 0 rows updated → either already bound (idempotent no-op) or the tid is
    // held by another org. Distinguish only to surface the collision.
    const conflict = await queryOne<{ id: string }>(
      `SELECT id FROM organizations WHERE entra_tid = $1 AND id <> $2`,
      [tid, orgId],
    );
    if (conflict) {
      context.warn(
        `tenant-binding: tenant already bound to org ${conflict.id} — not seeding org ${orgId} (first-bound-wins)`,
      );
    }
  } catch (err) {
    context.error('tenant-binding: seed failed', err);
  }
}

/**
 * The platform-wide self-registration master switch. Reads
 * platform_settings.user_access.allow_self_registration. #353 makes this
 * previously-decorative toggle a real global kill-switch for tenant auto-join.
 * Defaults to ON when the row/key is absent — matching the settings-UI default
 * (src/pages/platform-admin/PlatformSettings.tsx) and the issue's "ships
 * effectively on by default".
 */
export async function selfRegistrationEnabled(): Promise<boolean> {
  const row = await queryOne<{ allow_self_registration: boolean | null }>(
    `SELECT (value->>'allow_self_registration')::boolean AS allow_self_registration
       FROM platform_settings WHERE key = 'user_access'`,
  );
  return row?.allow_self_registration ?? true;
}

/**
 * Auto-join the caller to a bound org as a learner (#353) — the invite-less SSO
 * onboarding path, run on every user-context login. Non-destructive and
 * best-effort.
 *
 * Cheap-path first (no transaction): the overwhelmingly common login matches no
 * bound org, or the caller is already a member — both return before any seat
 * lock, mirroring adoptPendingInvites' pre-check philosophy.
 *
 * Joins only when ALL hold:
 *   • the verified tid is bindable and matches exactly one org's entra_tid,
 *   • the caller has NO membership row in that org (any status) — so a
 *     deliberately disabled member is never silently re-enabled and an admin is
 *     never downgraded (ON CONFLICT DO NOTHING backstops a race),
 *   • the master switch is on,
 *   • the org has a free seat (lockSeatUsage row-locks so concurrent joins
 *     cannot overshoot the cap).
 *
 * Otherwise a no-op: the caller stays an org-less account — the graceful
 * fallback that the individual tier (#354) will formalize, never a dead-end.
 */
export async function autoJoinByTenant(
  profileId: string,
  tid: string,
  context: InvocationContext,
): Promise<void> {
  if (!isBindableTenant(tid)) return;
  try {
    const org = await queryOne<{ id: string }>(
      `SELECT id FROM organizations WHERE entra_tid = $1`,
      [tid],
    );
    if (!org) return; // no org bound to this tenant

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
      [org.id, profileId],
    );
    if (existing) return; // already a member (any status) — leave it untouched

    if (!(await selfRegistrationEnabled())) return; // global kill-switch

    await withTransaction(async (client) => {
      const usage = await lockSeatUsage(client, org.id);
      if (!usage.exists || isAtSeatLimit(usage)) return; // org full → fallback
      await client.query(
        `INSERT INTO org_memberships (org_id, user_id, role, status)
         VALUES ($1, $2, 'learner', 'active')
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [org.id, profileId],
      );
    });
  } catch (err) {
    context.error('tenant-binding: auto-join failed', err);
  }
}
