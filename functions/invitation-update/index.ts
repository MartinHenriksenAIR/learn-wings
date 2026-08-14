import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('invitation-update', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { id?: unknown; status?: unknown };
  const { id, status } = body;

  if (!id || typeof id !== 'string') {
    return reply(400, { error: 'id is required' });
  }
  if (status !== 'expired') {
    return reply(400, { error: "status must be 'expired'" });
  }

  const existing = await queryOne<{ org_id: string }>(
    `SELECT org_id FROM invitations WHERE id = $1`,
    [id],
  );
  if (!existing) return reply(404, { error: 'Invitation not found' });

  await requireOrgAdmin(existing.org_id);

  const invitation = await queryOne(
    `UPDATE invitations SET status = 'expired'
     WHERE id = $1
     RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
               is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
    [id],
  );

  if (!invitation) return reply(404, { error: 'Invitation not found' });
  return reply(200, { invitation });
});
