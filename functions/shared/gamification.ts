import { query } from './db';
import { courseVisibilityPredicate } from './course-visibility';


export const LESSON_XP = 10;
export const QUIZ_XP = 25;
export const COURSE_XP = 100;

const TZ = 'Europe/Copenhagen';
const MONTH_START_SQL = `(date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;
const TODAY_SQL = `((now() AT TIME ZONE '${TZ}')::date)`;

export const WINDOW_DAYS = 7;
const WINDOW_SPAN = WINDOW_DAYS * 2;

const HERO_COURSES = 3;

export interface LevelInfo {
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
  snapshot: { started: number; inProgress: number; completed: number; overallPct: number };
  xp: { allTime: number; month: number };
  level: LevelInfo;
  streak: { current: number; activeToday: boolean };
  week: WeekActivity;
  courses: DashboardCourseCard[];
  recommended: DashboardCourseCard[];
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
  showLeaderboard: boolean;
}

const TOP_N = 10;

export function levelThreshold(level: number): number {
  return 50 * level * (level + 1) - 100;
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  const level = Math.floor((-50 + Math.sqrt(22500 + 200 * xp)) / 100);
  return Math.max(1, level);
}

export function levelProgress(xp: number): LevelInfo {
  const level = levelForXp(xp);
  const floor = levelThreshold(level);
  const nextThreshold = levelThreshold(level + 1);
  const xpForLevel = nextThreshold - floor;
  const xpIntoLevel = xp - floor;
  const xpToNext = nextThreshold - xp;
  return {
    level,
    xp,
    xpIntoLevel,
    xpForLevel,
    xpToNext,
    nextThreshold,
    progressPct: xpForLevel > 0 ? Math.round((xpIntoLevel / xpForLevel) * 100) : 0,
  };
}

export function displayName(p: { first_name?: string | null; last_name?: string | null; full_name?: string | null }): string {
  const full = (p.full_name ?? '').trim();
  const first = (p.first_name?.trim()) || full.split(/\s+/)[0] || '';
  let lastInitial = '';
  if (p.last_name?.trim()) {
    lastInitial = p.last_name.trim()[0];
  } else {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length > 1) lastInitial = parts[parts.length - 1][0];
  }
  return lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function computeStreak(today: string, daysDesc: string[]): { current: number; activeToday: boolean } {
  if (!daysDesc || daysDesc.length === 0) return { current: 0, activeToday: false };
  const set = new Set(daysDesc);
  const activeToday = set.has(today);
  const yesterday = addDays(today, -1);
  const mostRecent = daysDesc[0];
  if (mostRecent !== today && mostRecent !== yesterday) return { current: 0, activeToday };
  let current = 0;
  let cursor = mostRecent;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, activeToday };
}

interface AggRow { user_id: string; all_time: number; month: number }
interface MemberRow { user_id: string; first_name: string | null; last_name: string | null; full_name: string | null }
interface DayRow { day: string; lessons: number; minutes: number; untimed: number }
interface CourseRow { id: string; title: string; thumbnail_url: string | null; lessons_total: number; lessons_done: number }

function toCourseCard(r: CourseRow): DashboardCourseCard {
  const total = r.lessons_total ?? 0;
  const done = r.lessons_done ?? 0;
  return {
    courseId: r.id,
    title: r.title,
    thumbnailUrl: r.thumbnail_url,
    lessonsTotal: total,
    lessonsCompleted: done,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

export function buildWeekActivity(today: string, rows: DayRow[]): WeekActivity {
  const empty: WeekActivity = {
    lessons: 0, minutes: 0, untimedLessons: 0,
    perDayMinutes: new Array(WINDOW_DAYS).fill(0),
    previous: { lessons: 0, minutes: 0 },
  };
  if (!today) return empty;

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const dayAt = (offset: number) => byDay.get(addDays(today, offset));

  const perDayMinutes: number[] = [];
  let lessons = 0;
  let minutes = 0;
  let untimedLessons = 0;
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const row = dayAt(-i);
    perDayMinutes.push(row?.minutes ?? 0);
    lessons += row?.lessons ?? 0;
    minutes += row?.minutes ?? 0;
    untimedLessons += row?.untimed ?? 0;
  }

  let prevLessons = 0;
  let prevMinutes = 0;
  for (let i = WINDOW_SPAN - 1; i >= WINDOW_DAYS; i--) {
    const row = dayAt(-i);
    prevLessons += row?.lessons ?? 0;
    prevMinutes += row?.minutes ?? 0;
  }

  return { lessons, minutes, untimedLessons, perDayMinutes, previous: { lessons: prevLessons, minutes: prevMinutes } };
}

function rankWindow(
  members: { userId: string; name: string; xp: number }[],
  callerId: string,
): LeaderboardWindow {
  const sorted = [...members].sort((a, b) => (b.xp - a.xp) || a.name.localeCompare(b.name));
  const ranked: LeaderboardRow[] = sorted.map((m, i) => ({
    rank: i + 1,
    name: m.name,
    xp: m.xp,
    isSelf: m.userId === callerId,
  }));
  const me = ranked.find((r) => r.isSelf) ?? null;
  return { rows: ranked.slice(0, TOP_N), me };
}

export async function getLearnerDashboardData(
  orgId: string,
  callerId: string,
  opts?: { suppressLeaderboard?: boolean; isIndividual?: boolean; language?: string },
): Promise<LearnerDashboardData> {
  const recommendVisibility = opts?.isIndividual
    ? 'c.is_published = TRUE'
    : courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 });
  const recommendLanguage = opts?.language === 'en' ? 'en' : 'da';

  const [
    snapshotRows, lessonRows, quizRows, courseRows, memberRows, streakRows,
    dayRows, heroCourseRows, recommendedRows,
  ] = await Promise.all([
    query<{ started: number; in_progress: number; completed: number }>(
      `SELECT count(*)::int AS started,
              count(*) FILTER (WHERE status = 'enrolled')::int  AS in_progress,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM enrollments
        WHERE org_id = $1 AND user_id = $2`,
      [orgId, callerId],
    ),
    query<AggRow>(
      `SELECT user_id,
              count(*)::int AS all_time,
              count(*) FILTER (WHERE completed_at >= ${MONTH_START_SQL})::int AS month
         FROM lesson_progress
        WHERE org_id = $1 AND status = 'completed'
        GROUP BY user_id`,
      [orgId],
    ),
    query<AggRow>(
      `SELECT user_id,
              count(DISTINCT quiz_id)::int AS all_time,
              count(DISTINCT quiz_id) FILTER (WHERE finished_at >= ${MONTH_START_SQL})::int AS month
         FROM quiz_attempts
        WHERE org_id = $1 AND passed
        GROUP BY user_id`,
      [orgId],
    ),
    query<AggRow>(
      `SELECT user_id,
              count(*)::int AS all_time,
              count(*) FILTER (WHERE completed_at >= ${MONTH_START_SQL})::int AS month
         FROM enrollments
        WHERE org_id = $1 AND status = 'completed'
        GROUP BY user_id`,
      [orgId],
    ),
    opts?.suppressLeaderboard
      ? Promise.resolve([] as MemberRow[])
      : query<MemberRow>(
          `SELECT m.user_id, p.first_name, p.last_name, p.full_name
             FROM org_memberships m
             JOIN profiles p ON p.id = m.user_id
            WHERE m.org_id = $1 AND m.status = 'active' AND m.role = 'learner'`,
          [orgId],
        ),
    query<{ today: string; days: string[] | null }>(
      `SELECT ((now() AT TIME ZONE '${TZ}')::date)::text AS today,
              ARRAY(
                SELECT DISTINCT ((lp.completed_at AT TIME ZONE '${TZ}')::date)::text
                  FROM lesson_progress lp
                 WHERE lp.user_id = $1 AND lp.status = 'completed' AND lp.completed_at IS NOT NULL
                 ORDER BY 1 DESC
              ) AS days`,
      [callerId],
    ),
    query<DayRow>(
      `SELECT ((lp.completed_at AT TIME ZONE '${TZ}')::date)::text AS day,
              count(*)::int AS lessons,
              COALESCE(sum(l.duration_minutes), 0)::int AS minutes,
              count(*) FILTER (WHERE l.duration_minutes IS NULL)::int AS untimed
         FROM lesson_progress lp
         JOIN lessons l ON l.id = lp.lesson_id
        WHERE lp.org_id = $1 AND lp.user_id = $2
          AND lp.status = 'completed' AND lp.completed_at IS NOT NULL
          AND lp.completed_at >= ((${TODAY_SQL} - ${WINDOW_SPAN - 1}) AT TIME ZONE '${TZ}')
        GROUP BY 1`,
      [orgId, callerId],
    ),
    query<CourseRow>(
      `SELECT c.id, c.title, c.thumbnail_url,
              (SELECT count(*)::int
                 FROM course_modules cm JOIN lessons l ON l.module_id = cm.id
                WHERE cm.course_id = c.id) AS lessons_total,
              (SELECT count(*)::int
                 FROM lesson_progress lp
                 JOIN lessons l ON l.id = lp.lesson_id
                 JOIN course_modules cm ON cm.id = l.module_id
                WHERE cm.course_id = c.id AND lp.org_id = $1 AND lp.user_id = $2
                      AND lp.status = 'completed') AS lessons_done
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.org_id = $1 AND e.user_id = $2
        ORDER BY (e.status = 'enrolled') DESC, e.last_accessed_at DESC NULLS LAST, e.enrolled_at DESC
        LIMIT ${HERO_COURSES}`,
      [orgId, callerId],
    ),
    query<CourseRow>(
      `SELECT c.id, c.title, c.thumbnail_url,
              (SELECT count(*)::int
                 FROM course_modules cm JOIN lessons l ON l.module_id = cm.id
                WHERE cm.course_id = c.id) AS lessons_total,
              0 AS lessons_done,
              (SELECT count(*)::int FROM enrollments en WHERE en.course_id = c.id) AS popularity
         FROM courses c
        WHERE ${recommendVisibility}
              AND c.language = $2
              AND NOT EXISTS (
                    SELECT 1 FROM enrollments e
                     WHERE e.course_id = c.id AND e.user_id = $3 AND e.org_id = $1
                  )
              -- A course with no lessons is a dead end, not a recommendation:
              -- its tile would read "0 lessons" and open onto nothing.
              AND EXISTS (
                    SELECT 1 FROM course_modules cm
                      JOIN lessons l ON l.module_id = cm.id
                     WHERE cm.course_id = c.id
                  )
        ORDER BY popularity DESC, c.title
        LIMIT ${HERO_COURSES}`,
      [orgId, recommendLanguage, callerId],
    ),
  ]);

  const toMap = (rows: AggRow[]) => new Map(rows.map((r) => [r.user_id, r]));
  const lessons = toMap(lessonRows);
  const quizzes = toMap(quizRows);
  const courses = toMap(courseRows);
  const xpFor = (userId: string, window: 'all_time' | 'month') =>
    (lessons.get(userId)?.[window] ?? 0) * LESSON_XP +
    (quizzes.get(userId)?.[window] ?? 0) * QUIZ_XP +
    (courses.get(userId)?.[window] ?? 0) * COURSE_XP;

  const learnersAllTime = memberRows.map((m) => ({ userId: m.user_id, name: displayName(m), xp: xpFor(m.user_id, 'all_time') }));
  const learnersMonth = memberRows.map((m) => ({ userId: m.user_id, name: displayName(m), xp: xpFor(m.user_id, 'month') }));

  const xpAllTime = xpFor(callerId, 'all_time');
  const xpMonth = xpFor(callerId, 'month');

  const snapshotRow = snapshotRows[0] ?? { started: 0, in_progress: 0, completed: 0 };
  const streakRow = streakRows[0];

  return {
    snapshot: {
      started: snapshotRow.started,
      inProgress: snapshotRow.in_progress,
      completed: snapshotRow.completed,
      overallPct: snapshotRow.started > 0 ? Math.round((snapshotRow.completed / snapshotRow.started) * 100) : 0,
    },
    xp: { allTime: xpAllTime, month: xpMonth },
    level: levelProgress(xpAllTime),
    streak: computeStreak(streakRow?.today ?? '', streakRow?.days ?? []),
    week: buildWeekActivity(streakRow?.today ?? '', dayRows ?? []),
    courses: (heroCourseRows ?? []).map(toCourseCard),
    recommended: (recommendedRows ?? []).map(toCourseCard),
    showLeaderboard: !opts?.suppressLeaderboard,
    leaderboard: opts?.suppressLeaderboard
      ? { allTime: { rows: [], me: null }, month: { rows: [], me: null } }
      : { allTime: rankWindow(learnersAllTime, callerId), month: rankWindow(learnersMonth, callerId) },
  };
}
