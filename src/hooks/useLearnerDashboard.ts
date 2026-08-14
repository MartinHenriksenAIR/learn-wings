import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

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
  showLeaderboard: boolean;
}

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
