import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('ai-champions', async ({ req, reply, requireActiveMember }) => {
    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    // Authorization: platform admin OR active member of the org
    await requireActiveMember(orgId);

    const champions = await query(
      `SELECT a.*, json_build_object('id', pr.id, 'full_name', pr.full_name, 'department', pr.department) AS profile
       FROM ai_champions a JOIN profiles pr ON pr.id = a.user_id
       WHERE a.org_id = $1 ORDER BY a.assigned_at DESC`,
      [orgId],
    );

    return reply(200, { champions });
});
