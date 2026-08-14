import { isUniqueViolation, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { lockSeatUsage, seatsRemaining } from '../shared/seats';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
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

export default endpoint('invitation-bulk-create', async ({ req, context, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; invites?: unknown };
  const { orgId, invites } = body;

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

  await requireOrgAdmin(orgId);

  const validateOptionalText = (val: unknown): { ok: true; value: string | null } | { ok: false } => {
    if (val === undefined || val === null) return { ok: true, value: null };
    if (typeof val !== 'string') return { ok: false };
    if (val.length > 100) return { ok: false };
    return { ok: true, value: val === '' ? null : val };
  };

  const results: RowResult[] = await withTransaction(async (client) => {
    const rows: RowResult[] = [];
    const usage = await lockSeatUsage(client, orgId);
    let remaining = seatsRemaining(usage); // Infinity when unlimited

    for (const raw of invites as RawInvite[]) {
      const rawEmail = typeof raw?.email === 'string' ? raw.email : '';
      const normalizedEmail = rawEmail.toLowerCase().trim();

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

      if (!usage.exists) {
        rows.push({ email: normalizedEmail, success: false, error: 'Organization not found' });
        continue;
      }
      if (remaining <= 0) {
        rows.push({ email: normalizedEmail, success: false, error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
        continue;
      }

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
