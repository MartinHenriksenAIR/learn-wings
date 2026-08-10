import { endpoint } from '../shared/endpoint';
import { queryOne } from '../shared/db';
import { getLearnerDashboardData } from '../shared/gamification';
import { resolveVisibilityContext } from '../shared/course-visibility';

/**
 * Learner-dashboard data for the motivation hub (issue #362): a progress
 * snapshot (course counts), the caller's org-scoped XP + level, their global
 * personal streak, and the org-scoped leaderboard (all-time + this month).
 *
 * All derived live — see shared/gamification.ts. Org isolation is enforced by
 * requireActiveMember before any org-scoped query runs; the leaderboard is
 * built from org_memberships, never a client-supplied user list (#373).
 *
 * For the individual (self-serve) tier the placeholder org pools unrelated solo
 * learners, so the leaderboard is suppressed at the backend — detected by
 * kind='individual' via resolveVisibilityContext, never a hard-coded id (#354).
 *
 * An org may also opt out of the leaderboard entirely (#369): the switch rides in
 * the org_settings features jsonb as an org-only key (absent ⇒ true, the default).
 * When off, the board is suppressed the same way — the derivation queries never run
 * and no member names/XP cross the wire.
 */
export default endpoint('learner-dashboard', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const { isIndividual } = await resolveVisibilityContext(orgId, profile.id);

  // #369 per-org opt-out. A missing row or a missing key ⇒ enabled (the default);
  // only an explicit `false` turns it off.
  const settingsRow = await queryOne<{ features: { leaderboard_enabled?: boolean } | null }>(
    `SELECT features FROM org_settings WHERE org_id = $1`,
    [orgId],
  );
  const leaderboardOff = settingsRow?.features?.leaderboard_enabled === false;

  const data = await getLearnerDashboardData(orgId, profile.id, {
    suppressLeaderboard: isIndividual || leaderboardOff,
  });
  return reply(200, data);
});
