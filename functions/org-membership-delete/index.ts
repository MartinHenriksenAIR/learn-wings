import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-membership-delete', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { id?: unknown };
  const { id } = body;

  if (!id || typeof id !== 'string') {
    return reply(400, { error: 'id is required' });
  }

  const existing = await queryOne<{ org_id: string }>(
    `SELECT org_id FROM org_memberships WHERE id = $1`,
    [id],
  );
  if (!existing) return reply(404, { error: 'Membership not found' });

  await requireOrgAdmin(existing.org_id);

  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM org_memberships WHERE id = $1 RETURNING id`,
    [id],
  );

  if (!deleted) return reply(404, { error: 'Membership not found' });
  return reply(200, { ok: true });
});
