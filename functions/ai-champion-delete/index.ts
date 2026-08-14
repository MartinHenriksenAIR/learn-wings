import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('ai-champion-delete', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; userId?: unknown };
  const { orgId, userId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!userId || typeof userId !== 'string') {
    return reply(400, { error: 'userId is required' });
  }

  await requireOrgAdmin(orgId);

  await query(
    `DELETE FROM ai_champions WHERE user_id = $1 AND org_id = $2`,
    [userId, orgId],
  );

  return reply(200, { ok: true });
});
