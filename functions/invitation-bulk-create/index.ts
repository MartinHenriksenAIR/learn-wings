import { isUniqueViolation, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { lockSeatUsage, seatsRemaining } from '../shared/seats';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
// Basic email regex — matches the BulkInviteDialog / invitation-create validation.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES = 500;

type RawInvite = {
  email?: unknown;
  role?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  department?: unknown;
};

type RowResult = {
  email: string;
  success: boolean;
  invitation?: unknown;
  error?: string;
  code?: string;
};

/**
 * Bulk variant of invitation-create — replaces the per-row loop the BulkInviteDialog
 * used to run on the client (one network call per CSV row). The dialog now sends
 * a single call with an array of invites; we INSERT each row independently so one
 * bad row does not abort the rest. Sequential (no Promise.all) to keep deterministic
 * ordering and avoid hammering the small connection pool.
 *
 * Seat-limit enforcement (issue #126): the whole batch runs in ONE transaction with a
 * single `FOR UPDATE` lock on the organization row (see functions/shared/seats.ts).
 * Seats fill partially in request order — valid rows succeed until the org's seats run
 * out, after which every further valid row fails with a seat-limit error. `remaining`
 * is tracked locally and decremented only on a successful INSERT; the row lock (held
 * for the whole batch) keeps that count authoritative against concurrent creates.
 * Partial success is still intentional: per-row failures (validation, duplicate,
 * seat cap) surface as `success: false` and never abort the batch. Each INSERT runs
 * inside a per-row SAVEPOINT so a failed statement (e.g. a duplicate pending email)
 * can be rolled back without poisoning the surrounding transaction.
 * `token` / `token_hash` are NEVER exposed in the response (same security note as
 * invitation-create).
 */
export default endpoint('invitation-bulk-create', async ({ req, context, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; invites?: unknown };
  const { orgId, invites } = body;

  // Request-level validation: shape errors abort the whole request with 400.
  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (invites === undefined || invites === null) {
    return reply(400, { error: 'invites is required' });
  }
  if (!Array.isArray(invites)) {
    return reply(400, { error: 'invites must be an array' });
  }
  if (invites.length === 0) {
    return reply(400, { error: 'invites must not be empty' });
  }
  if (invites.length > MAX_INVITES) {
    return reply(400, { error: `invites must not exceed ${MAX_INVITES} entries` });
  }

  // Authorization: platform admin OR org admin of the target org.
  // RLS provenance: supabase/migrations/20260130144031_*.sql —
  // "Admins can insert invitations" policy (WITH CHECK is_platform_admin()
  // OR (org_id IS NOT NULL AND is_org_admin(org_id))). Same gate as invitation-create.
  await requireOrgAdmin(orgId);

  const validateOptionalText = (val: unknown): { ok: true; value: string | null } | { ok: false } => {
    if (val === undefined || val === null) return { ok: true, value: null };
    if (typeof val !== 'string') return { ok: false };
    if (val.length > 100) return { ok: false };
    return { ok: true, value: val === '' ? null : val };
  };

  // Per-row processing inside ONE transaction. Each row resolves to a result entry —
  // never throws out of the loop. Sequential by design (see header comment).
  const results: RowResult[] = await withTransaction(async (client) => {
    const rows: RowResult[] = [];
    const usage = await lockSeatUsage(client, orgId);
    let remaining = seatsRemaining(usage); // Infinity when unlimited

    for (const raw of invites as RawInvite[]) {
      const rawEmail = typeof raw?.email === 'string' ? raw.email : '';
      const normalizedEmail = rawEmail.toLowerCase().trim();

      // Per-row validation — non-fatal. Failed rows surface as success: false and
      // NEVER consume a seat (validation always precedes the seat check).
      if (!rawEmail || typeof raw.email !== 'string' || !EMAIL_REGEX.test(rawEmail)) {
        rows.push({ email: normalizedEmail, success: false, error: 'email is required and must be a valid email address' });
        continue;
      }
      if (typeof raw.role !== 'string' || !ALLOWED_ROLES.has(raw.role)) {
        rows.push({ email: normalizedEmail, success: false, error: 'role must be one of: org_admin, learner' });
        continue;
      }
      const fnRes = validateOptionalText(raw.firstName);
      if (!fnRes.ok) {
        rows.push({ email: normalizedEmail, success: false, error: 'firstName must be a string of 100 characters or fewer' });
        continue;
      }
      const lnRes = validateOptionalText(raw.lastName);
      if (!lnRes.ok) {
        rows.push({ email: normalizedEmail, success: false, error: 'lastName must be a string of 100 characters or fewer' });
        continue;
      }
      const deptRes = validateOptionalText(raw.department);
      if (!deptRes.ok) {
        rows.push({ email: normalizedEmail, success: false, error: 'department must be a string of 100 characters or fewer' });
        continue;
      }

      // Org existence: a platform admin can pass a bad orgId (requireOrgAdmin bypasses
      // the existence check for platform admins), so guard here before any INSERT.
      if (!usage.exists) {
        rows.push({ email: normalizedEmail, success: false, error: 'Organization not found' });
        continue;
      }
      // Seat cap: partial-fill in request order. Once seats are exhausted, every
      // further valid row fails — the batch does not abort.
      if (remaining <= 0) {
        rows.push({ email: normalizedEmail, success: false, error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
        continue;
      }

      // Per-row SAVEPOINT: a failed INSERT (e.g. duplicate pending) aborts the current
      // transaction state; SAVEPOINT/ROLLBACK-TO lets us recover and keep going. This is
      // MANDATORY — without it, one bad row would poison the whole batch.
      await client.query('SAVEPOINT bulk_row');
      try {
        const insertRes = await client.query(
          `INSERT INTO invitations (org_id, email, role, invited_by_user_id, first_name, last_name, department)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
                     is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
          [orgId, normalizedEmail, raw.role, profile.id, fnRes.value, lnRes.value, deptRes.value],
        );
        await client.query('RELEASE SAVEPOINT bulk_row');
        rows.push({ email: normalizedEmail, success: true, invitation: insertRes.rows[0] });
        remaining -= 1; // only a successful insert consumes a seat
      } catch (dbErr: unknown) {
        await client.query('ROLLBACK TO SAVEPOINT bulk_row');
        await client.query('RELEASE SAVEPOINT bulk_row');
        if (isUniqueViolation(dbErr)) {
          rows.push({ email: normalizedEmail, success: false, error: 'An invitation for this email is already pending' });
        } else if ((dbErr as { code?: string })?.code === '23503') {
          rows.push({ email: normalizedEmail, success: false, error: 'Organization not found' });
        } else {
          // Unexpected DB error for this row. The request-level internalError never
          // sees it (the loop intentionally swallows per-row failures), so log it
          // here for App Insights, and return a CONSTANT message — never the raw
          // driver text (CWE-209, ADR-0014, #25 — the leak was still open inside
          // this loop).
          const message = dbErr instanceof Error ? dbErr.message : String(dbErr);
          const stack = dbErr instanceof Error && dbErr.stack ? `\n${dbErr.stack}` : '';
          context.error(`invitation-bulk-create row failed: ${message}${stack}`);
          rows.push({ email: normalizedEmail, success: false, error: 'Could not create invitation' });
        }
      }
    }
    return rows;
  });

  return reply(200, { results });
});
