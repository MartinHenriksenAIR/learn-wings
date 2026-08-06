import { endpoint } from '../shared/endpoint';
import { getLearnerDashboardData } from '../shared/gamification';

/**
 * Learner-dashboard data for the motivation hub (issue #362): a progress
 * snapshot (course counts), the caller's org-scoped XP + level, their global
 * personal streak, and the org-scoped leaderboard (all-time + this month).
 *
 * All derived live — see shared/gamification.ts. Org isolation is enforced by
 * requireActiveMember before any org-scoped query runs; the leaderboard is
 * built from org_memberships, never a client-supplied user list (#373).
 */
export default endpoint('learner-dashboard', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const data = await getLearnerDashboardData(orgId, profile.id);
  return reply(200, data);
});
