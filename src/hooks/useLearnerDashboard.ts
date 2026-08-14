import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';

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

export interface DashboardCourseCard {
  courseId: string;
  title: string;
  thumbnailUrl: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  pct: number;
}

export interface WeekActivity {
  lessons: number;
  minutes: number;
  untimedLessons: number;
  perDayMinutes: number[];
  previous: { lessons: number; minutes: number };
}

export interface LearnerDashboardData {
  snapshot: DashboardSnapshot;
  xp: { allTime: number; month: number };
  level: DashboardLevel;
  streak: { current: number; activeToday: boolean };
  week: WeekActivity;
  courses: DashboardCourseCard[];
  recommended: DashboardCourseCard[];
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
  showLeaderboard: boolean;
}

export function useLearnerDashboard(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.learnerDashboard.detail(orgId),
    queryFn: async () => {
      const data = await callApi<LearnerDashboardData>('/api/learner-dashboard', { orgId });
      const sign = (cards: DashboardCourseCard[] | undefined) =>
        Promise.all(
          (Array.isArray(cards) ? cards : []).map(async (c) => ({
            ...c,
            thumbnailUrl: await getSignedLmsAssetUrl(c.thumbnailUrl),
          })),
        );
      const [courses, recommended] = await Promise.all([sign(data.courses), sign(data.recommended)]);
      const week: WeekActivity = data.week ?? {
        lessons: 0,
        minutes: 0,
        untimedLessons: 0,
        perDayMinutes: new Array(7).fill(0),
        previous: { lessons: 0, minutes: 0 },
      };
      return { ...data, week, courses, recommended };
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
