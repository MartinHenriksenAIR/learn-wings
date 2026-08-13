import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';

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

/** A course tile in the hero. `thumbnailUrl` arrives as a storage path and is signed in the queryFn. */
export interface DashboardCourseCard {
  courseId: string;
  title: string;
  thumbnailUrl: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  pct: number;
}

/**
 * Rolling-seven-day activity: today plus the six days before it, against the
 * seven days before that (#455). `minutes` sums the authored
 * `lessons.duration_minutes` of lessons completed in the window — learning
 * time, not measured time-on-task — and `untimedLessons` counts the completions
 * whose lesson carries no length, so the figure can be shown as the partial
 * count it is.
 */
export interface WeekActivity {
  lessons: number;
  minutes: number;
  untimedLessons: number;
  /** Minutes per day, oldest → today. Seven entries. */
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
  // False when the leaderboard is suppressed server-side (individual tier #354,
  // or a per-org opt-out #369) — hide the widget rather than show an empty board.
  showLeaderboard: boolean;
}

/**
 * Fetch the learner's dashboard data for `orgId`: a progress snapshot,
 * org-scoped XP + level, the global personal streak, the rolling-seven-day
 * activity behind the hero headline and trend card, the hero's course tiles,
 * and the org-scoped leaderboard. All derived server-side; one round-trip.
 *
 * Course thumbnails come back as storage paths and are signed here, so callers
 * always receive a usable URL (or null, for the accent-fill fallback) without
 * any post-fetch state management.
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
      // The frontend and the functions deploy from trunk through two separate
      // workflows, so there is a window where this build talks to the previous
      // API. Defaulting the #455 additions keeps the dashboard rendering
      // through it instead of white-screening on a missing field.
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
