import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

// Shape of the derived learner-dashboard payload (see functions/shared/gamification.ts).
export interface DashboardSnapshot {
  started: number;
  inProgress: number;
  completed: number;
  overallPct: number;
}

export interface DashboardLevel {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForLevel: number;
  xpToNext: number;
  nextThreshold: number;
  progressPct: number;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  xp: number;
  isSelf: boolean;
}

export interface LeaderboardWindow {
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
}

export interface LearnerDashboardData {
  snapshot: DashboardSnapshot;
  xp: { allTime: number; month: number };
  level: DashboardLevel;
  streak: { current: number; activeToday: boolean };
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
  // False when the leaderboard is suppressed server-side (individual tier #354,
  // or a per-org opt-out #369) — hide the widget rather than show an empty board.
  showLeaderboard: boolean;
}

/**
 * Fetch the learner's motivation-hub dashboard data for `orgId`: a progress
 * snapshot, org-scoped XP + level, the global personal streak, and the
 * org-scoped leaderboard (all-time + this month). All derived server-side; one
 * round-trip. Continue-learning now lives in Min Træning (useLearnerTraining).
 *
 * `enabled` defaults to `!!orgId` — pass it explicitly to gate on the org-guard
 * state (e.g. `enabled: orgGuard === 'ready' && !!currentOrg`).
 */
export function useLearnerDashboard(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.learnerDashboard.detail(orgId),
    queryFn: () => callApi<LearnerDashboardData>('/api/learner-dashboard', { orgId }),
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
