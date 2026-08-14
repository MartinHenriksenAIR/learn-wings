import { endpoint } from '../shared/endpoint';
import { queryOne } from '../shared/db';
import { getLearnerDashboardData } from '../shared/gamification';
import { resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('learner-dashboard', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const [{ isIndividual }, settingsRow] = await Promise.all([
    resolveVisibilityContext(orgId, profile.id),
    queryOne<{ features: { leaderboard_enabled?: boolean } | null }>(
      `SELECT features FROM org_settings WHERE org_id = $1`,
      [orgId],
    ),
  ]);
  const leaderboardOff = settingsRow?.features?.leaderboard_enabled === false;

  const data = await getLearnerDashboardData(orgId, profile.id, {
    suppressLeaderboard: isIndividual || leaderboardOff,
  });
  return reply(200, data);
});
