import { isUniqueViolation, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isAtSeatLimit, lockSeatUsage } from '../shared/seats';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default endpoint('invitation-create', async ({ req, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as {
    orgId?: unknown;
    email?: unknown;
    role?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    department?: unknown;
  };
  const { orgId, email, role, firstName, lastName, department } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    return reply(400, { error: 'email is required and must be a valid email address' });
  }
  if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
    return reply(400, { error: 'role must be one of: org_admin, learner' });
  }
  const validateOptionalText = (val: unknown, field: string): string | null | undefined => {
    if (val === undefined || val === null) return null;
    if (typeof val !== 'string') return undefined;
    if (val.length > 100) return undefined;
    return val === '' ? null : val;
  };
  const fnVal = validateOptionalText(firstName, 'firstName');
  if (fnVal === undefined) {
    return reply(400, { error: 'firstName must be a string of 100 characters or fewer' });
  }
  const lnVal = validateOptionalText(lastName, 'lastName');
  if (lnVal === undefined) {
    return reply(400, { error: 'lastName must be a string of 100 characters or fewer' });
  }
  const deptVal = validateOptionalText(department, 'department');
  if (deptVal === undefined) {
    return reply(400, { error: 'department must be a string of 100 characters or fewer' });
  }

  await requireOrgAdmin(orgId);

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const result = await withTransaction(async (client) => {
      const usage = await lockSeatUsage(client, orgId);
      if (!usage.exists) return { kind: 'not_found' as const };
      if (isAtSeatLimit(usage)) return { kind: 'seat_limit' as const };
      const insertRes = await client.query(
        `INSERT INTO invitations (org_id, email, role, invited_by_user_id, first_name, last_name, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
                   is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
        [orgId, normalizedEmail, role, profile.id, fnVal, lnVal, deptVal],
      );
      return { kind: 'created' as const, invitation: insertRes.rows[0] };
    });
    if (result.kind === 'not_found') return reply(404, { error: 'Organization not found' });
    if (result.kind === 'seat_limit') return reply(409, { error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
    return reply(200, { invitation: result.invitation });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'An invitation for this email is already pending' });
    }
    if ((dbErr as { code?: string })?.code === '23503') {
      return reply(404, { error: 'Organization not found' });
    }
    throw dbErr;
  }
});
