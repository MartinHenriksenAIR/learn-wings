import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('ai-champion-create', async ({ req, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; userId?: unknown };
  const { orgId, userId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!userId || typeof userId !== 'string') {
    return reply(400, { error: 'userId is required' });
  }

  await requireOrgAdmin(orgId);

  try {
    const champion = await queryOne(
      `INSERT INTO ai_champions (user_id, org_id, assigned_by)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, org_id, assigned_by, assigned_at`,
      [userId, orgId, profile.id],
    );
    return reply(200, { champion });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'User is already an AI Champion in this organization' });
    }
    if ((dbErr as { code?: string })?.code === '23503') {
      return reply(404, { error: 'Organization or user not found' });
    }
    throw dbErr;
  }
});
