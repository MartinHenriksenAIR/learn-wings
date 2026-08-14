import type { InvocationContext } from '@azure/functions';
import { query, queryOne, withTransaction, isUniqueViolation } from './db';
import { lockSeatUsage, isAtSeatLimit } from './seats';


export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

export function isBindableTenant(tid: string | null | undefined): boolean {
  return typeof tid === 'string' && tid.trim().length > 0 && tid !== CONSUMER_TENANT_ID;
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

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
    if (isUniqueViolation(err)) {
      context.warn(`tenant-binding: concurrent seed lost the race for org ${orgId} (first-bound-wins)`);
    } else {
      context.error('tenant-binding: seed failed', err);
    }
  }
}

export async function selfRegistrationEnabled(): Promise<boolean> {
  const row = await queryOne<{ allow_self_registration: boolean | null }>(
    `SELECT (value->>'allow_self_registration')::boolean AS allow_self_registration
       FROM platform_settings WHERE key = 'user_access'`,
  );
  return row?.allow_self_registration ?? true;
}

export async function individualTierEnabled(): Promise<boolean> {
  const row = await queryOne<{ allow_individual_registration: boolean | null }>(
    `SELECT (value->>'allow_individual_registration')::boolean AS allow_individual_registration
       FROM platform_settings WHERE key = 'user_access'`,
  );
  return row?.allow_individual_registration ?? true;
}

export async function autoJoinByTenant(
  profileId: string,
  tid: string,
  context: InvocationContext,
): Promise<void> {
  if (!isBindableTenant(tid)) return;
  try {
    const org = await queryOne<{ id: string; allow_self_registration: boolean }>(
      `SELECT id, allow_self_registration FROM organizations WHERE entra_tid = $1`,
      [tid],
    );
    if (!org) return; // no org bound to this tenant

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
      [org.id, profileId],
    );
    if (existing) return; // already a member (any status) — leave it untouched

    if (!org.allow_self_registration) return; // per-org switch off (#356) — invite required
    if (!(await selfRegistrationEnabled())) return; // platform-wide master switch

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
