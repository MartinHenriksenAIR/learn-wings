import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
const ALLOWED_STATUSES = new Set(['active', 'invited', 'disabled']);

export default endpoint('org-membership-update', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { id?: unknown; role?: unknown; status?: unknown };
  const { id, role, status } = body;

  // Validation first, lookup → authz, then UPDATE.
  if (!id || typeof id !== 'string') {
    return reply(400, { error: 'id is required' });
  }
  if (role === undefined && status === undefined) {
    return reply(400, { error: 'No update fields provided' });
  }
  if (role !== undefined && (typeof role !== 'string' || !ALLOWED_ROLES.has(role))) {
    return reply(400, { error: 'role must be one of: org_admin, learner' });
  }
  if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
    return reply(400, { error: 'status must be one of: active, invited, disabled' });
  }

  // Lookup first so we know which org to check authz against, and to give a
  // clean 404 for missing memberships (instead of relying on UPDATE RETURNING).
  const existing = await queryOne<{ org_id: string }>(
    `SELECT org_id FROM org_memberships WHERE id = $1`,
    [id],
  );
  if (!existing) return reply(404, { error: 'Membership not found' });

  // Authorization: platform admin OR org admin of the membership's org.
  // RLS provenance: supabase/migrations/20260127153401_*.sql lines 279-285 —
  // "Platform admins can do everything with memberships" (is_platform_admin())
  // + "Org admins can manage memberships in their org" (is_org_admin(org_id)).
  await requireOrgAdmin(existing.org_id);

  // Dynamic UPDATE built from supplied keys only (mirrors organization-update).
  const params: unknown[] = [];
  const setClauses: string[] = [];
  if (role !== undefined) {
    params.push(role);
    setClauses.push(`role = $${params.length}`);
  }
  if (status !== undefined) {
    params.push(status);
    setClauses.push(`status = $${params.length}`);
  }
  params.push(id);
  const idIndex = params.length;

  const membership = await queryOne(
    `UPDATE org_memberships SET ${setClauses.join(', ')}
     WHERE id = $${idIndex}
     RETURNING id, org_id, user_id, role, status, created_at`,
    params,
  );

  // TOCTOU: row vanished between SELECT and UPDATE — treat as not found.
  if (!membership) return reply(404, { error: 'Membership not found' });
  return reply(200, { membership });
});
