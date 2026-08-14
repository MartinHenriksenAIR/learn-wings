import { isUniqueViolation, withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isAtSeatLimit, lockSeatUsage } from '../shared/seats';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
const ALLOWED_STATUSES = new Set(['active', 'disabled']);

export default endpoint('org-membership-create', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; userId?: unknown; role?: unknown; status?: unknown };
  const { orgId, userId, role, status } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!userId || typeof userId !== 'string') {
    return reply(400, { error: 'userId is required' });
  }
  if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
    return reply(400, { error: 'role must be one of: org_admin, learner' });
  }
  if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
    return reply(400, { error: 'status must be one of: active, disabled' });
  }

  await requireOrgAdmin(orgId);

  const effectiveStatus = status ?? 'active';

  try {
    const result = await withTransaction(async (client) => {
      const usage = await lockSeatUsage(client, orgId);
      if (!usage.exists) return { kind: 'not_found' as const };
      if (isAtSeatLimit(usage)) return { kind: 'seat_limit' as const };
      const insertRes = await client.query(
        `INSERT INTO org_memberships (org_id, user_id, role, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, org_id, user_id, role, status, created_at`,
        [orgId, userId, role, effectiveStatus],
      );
      return { kind: 'created' as const, membership: insertRes.rows[0] };
    });

    if (result.kind === 'not_found') {
      return reply(404, { error: 'Organization or user not found' });
    }
    if (result.kind === 'seat_limit') {
      return reply(409, { error: 'Organization is at seat limit', code: 'SEAT_LIMIT_REACHED' });
    }
    return reply(200, { membership: result.membership });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'User is already a member of this organization' });
    }
    if ((dbErr as { code?: string })?.code === '23503') {
      return reply(404, { error: 'Organization or user not found' });
    }
    throw dbErr;
  }
});
