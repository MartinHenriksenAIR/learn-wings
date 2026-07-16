import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-memberships', async ({ req, reply, requireOrgAdmin }) => {
  const { orgId } = await req.json() as { orgId?: string };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireOrgAdmin(orgId);

  // NO status filter — org admins manage their full roster incl. invited/disabled members
  const memberships = await query(
    `SELECT om.id, om.org_id, om.user_id, om.role, om.status, om.created_at,
            p.full_name, p.email, p.avatar_url, p.department
       FROM org_memberships om
       JOIN profiles p ON p.id = om.user_id
      WHERE om.org_id = $1
      ORDER BY p.full_name`,
    [orgId],
  );
  return reply(200, { memberships });
});
