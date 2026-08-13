import { query } from './db';
import { courseVisibilityPredicate } from './course-visibility';

/**
 * Derived gamification for the learner dashboard (issue #362).
 *
 * There are NO XP / streak / leaderboard tables. XP, streaks, and both
 * leaderboard windows are computed live from the existing completion tables
 * (lesson_progress, quiz_attempts, enrollments), backed by the read-indexes in
 * migration/azure/14-gamification-indexes.sql. Nothing is stored; nothing can
 * drift from real progress.
 *
 * Security: XP and the leaderboard are strictly org-scoped. Every query filters
 * by the caller-supplied orgId AFTER the endpoint has proven active membership
 * (requireActiveMember). Leaderboard membership is derived from org_memberships
 * — never from a client-supplied user list — so no data crosses orgs (#373).
 */

// XP earning rates. Distinct items only (lesson_progress is unique per lesson,
// enrollments unique per course; quizzes counted as DISTINCT passed quiz_id) —
// so re-completing/re-taking cannot farm points.
export const LESSON_XP = 10;
export const QUIZ_XP = 25;
export const COURSE_XP = 100;

// The learner's local day boundary. This is a Danish platform; bucket everyone
// by Copenhagen time rather than UTC so an evening session lands on the right
// day (WEBSITE_TIME_ZONE is unset — do not rely on server-local time).
const TZ = 'Europe/Copenhagen';
// Start of the current calendar month as a timestamptz instant, in Copenhagen
// local time. Inlined (not a param) so the derived filter needs no JS tz math.
const MONTH_START_SQL = `(date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;
// Today's Copenhagen calendar date, as a `date`.
const TODAY_SQL = `((now() AT TIME ZONE '${TZ}')::date)`;

/**
 * The activity window behind the hero headline and the trend card (#455).
 *
 * ROLLING SEVEN DAYS, not the ISO week: today plus the six days before it,
 * bucketed by Copenhagen calendar day (same boundary as the streak). Compared
 * against the seven days before that. A calendar week would make the comparison
 * a partial week against a whole one — "-60% vs last week" every Monday — and
 * would leave the sparkline with a single point at the start of a week. The
 * copy says "last 7 days" accordingly; it must never claim "this week".
 */
export const WINDOW_DAYS = 7;
// Both windows in one read: the current 7 days plus the 7 before them.
const WINDOW_SPAN = WINDOW_DAYS * 2;

// Course cards in the hero slab — in-progress courses, or recommendations for a
// learner with nothing started yet.
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

/** One course tile in the hero slab. `thumbnailUrl` is a raw storage path — the client signs it. */
export interface DashboardCourseCard {
  courseId: string;
  title: string;
  thumbnailUrl: string | null;
  lessonsTotal: number;
  lessonsCompleted: number;
  pct: number;
}

/**
 * Rolling-seven-day learning activity (see WINDOW_DAYS).
 *
 * `minutes` is the summed `lessons.duration_minutes` of lessons COMPLETED in the
 * window — an authored estimate of lesson length, not measured time-on-task
 * (the schema tracks no such thing). `duration_minutes` is nullable, so
 * `untimedLessons` reports how many completed lessons carried no length and are
 * therefore absent from the total; the UI discloses it rather than letting the
 * figure silently undercount.
 */
export interface WeekActivity {
  lessons: number;
  minutes: number;
  untimedLessons: number;
  /** Minutes per day, oldest → today, exactly WINDOW_DAYS entries (the sparkline). */
  perDayMinutes: number[];
  previous: { lessons: number; minutes: number };
}

export interface LearnerDashboardData {
  snapshot: { started: number; inProgress: number; completed: number; overallPct: number };
  xp: { allTime: number; month: number };
  level: LevelInfo;
  streak: { current: number; activeToday: boolean };
  week: WeekActivity;
  /** Up to three in-progress courses for the hero, most recently opened first. */
  courses: DashboardCourseCard[];
  /** Up to three catalogue courses for a learner with nothing in progress. */
  recommended: DashboardCourseCard[];
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
  // Whether the client should render the leaderboard at all. False when the board
  // is suppressed — individual tier (#354) OR a per-org opt-out (#369). The board
  // windows are already empty when suppressed; this flag lets the UI HIDE the
  // widget rather than show an empty "be the first" state for a disabled feature.
  showLeaderboard: boolean;
}

const TOP_N = 10;

// Level thresholds rise so early levels come fast and later ones take longer:
// threshold(L) = 50·L·(L+1) − 100  →  0, 200, 500, 900, 1400, 2000, …
// (gaps grow 200/300/400/500…). Kept as a closed form so both directions are
// exact and cheap.
export function levelThreshold(level: number): number {
  return 50 * level * (level + 1) - 100;
}

export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  // Invert 50L² + 50L − 100 ≤ xp  →  L = ⌊(−50 + √(22500 + 200·xp)) / 100⌋.
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

/** First name + last initial ("Martin H."). Falls back to full_name tokens. */
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

// Step an ISO date ('YYYY-MM-DD') by n days. Pure calendar math on UTC midnights
// (the dates are already bucketed to Copenhagen days in SQL, so UTC stepping has
// no DST hazard).
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Current streak = run of consecutive active days ending today or yesterday.
 * The "or yesterday" grace means the streak does not visibly collapse at
 * midnight — you have all of today to keep it. `daysDesc` are the distinct
 * Copenhagen activity-days, most-recent first; `today` is the Copenhagen date.
 */
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

/**
 * Fold the per-day rows into the two rolling windows. `today` is the Copenhagen
 * date the rest of the payload is bucketed against, so both windows and the
 * streak always agree on where "today" ends. Days with no completions are
 * absent from `rows` and become zeroes — the sparkline needs a value per day.
 */
export function buildWeekActivity(today: string, rows: DayRow[]): WeekActivity {
  const empty: WeekActivity = {
    lessons: 0, minutes: 0, untimedLessons: 0,
    perDayMinutes: new Array(WINDOW_DAYS).fill(0),
    previous: { lessons: 0, minutes: 0 },
  };
  // No anchor date (the streak query returned nothing) — a flat window beats
  // stepping off an unparseable date and emitting NaNs.
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

/**
 * Build the whole learner-dashboard payload for `callerId` in `orgId`.
 * Runs the derived queries in parallel; the query order below is the contract
 * the endpoint test asserts against.
 */
export async function getLearnerDashboardData(
  orgId: string,
  callerId: string,
  opts?: { suppressLeaderboard?: boolean; isIndividual?: boolean; language?: string },
): Promise<LearnerDashboardData> {
  // Recommendation visibility mirrors learner-courses: standard orgs see
  // published + org-enabled courses, individuals bypass org_course_access.
  // The language is the caller's server-side preference — the dashboard request
  // carries no UI language, and a learner cannot widen their own catalogue.
  const recommendVisibility = opts?.isIndividual
    ? 'c.is_published = TRUE'
    : courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 });
  const recommendLanguage = opts?.language === 'en' ? 'en' : 'da';

  const [
    snapshotRows, lessonRows, quizRows, courseRows, memberRows, streakRows,
    dayRows, heroCourseRows, recommendedRows,
  ] = await Promise.all([
    // 1 · snapshot — course counts for the caller (deep-link cards → Min Træning)
    query<{ started: number; in_progress: number; completed: number }>(
      `SELECT count(*)::int AS started,
              count(*) FILTER (WHERE status = 'enrolled')::int  AS in_progress,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM enrollments
        WHERE org_id = $1 AND user_id = $2`,
      [orgId, callerId],
    ),
    // 2 · lessons per member (org-scoped), all-time + this month
    query<AggRow>(
      `SELECT user_id,
              count(*)::int AS all_time,
              count(*) FILTER (WHERE completed_at >= ${MONTH_START_SQL})::int AS month
         FROM lesson_progress
        WHERE org_id = $1 AND status = 'completed'
        GROUP BY user_id`,
      [orgId],
    ),
    // 3 · distinct quizzes passed per member
    query<AggRow>(
      `SELECT user_id,
              count(DISTINCT quiz_id)::int AS all_time,
              count(DISTINCT quiz_id) FILTER (WHERE finished_at >= ${MONTH_START_SQL})::int AS month
         FROM quiz_attempts
        WHERE org_id = $1 AND passed
        GROUP BY user_id`,
      [orgId],
    ),
    // 4 · courses completed per member
    query<AggRow>(
      `SELECT user_id,
              count(*)::int AS all_time,
              count(*) FILTER (WHERE completed_at >= ${MONTH_START_SQL})::int AS month
         FROM enrollments
        WHERE org_id = $1 AND status = 'completed'
        GROUP BY user_id`,
      [orgId],
    ),
    // 5 · leaderboard membership — active LEARNERS only, from org_memberships
    //     (never a client-supplied list). Admins are excluded from the board.
    //     Suppressed for the individual (self-serve) tier: the placeholder org
    //     pools unrelated solo learners, so the query is not run at all and no
    //     stranger names/XP ever cross the wire (#354/#373).
    opts?.suppressLeaderboard
      ? Promise.resolve([] as MemberRow[])
      : query<MemberRow>(
          `SELECT m.user_id, p.first_name, p.last_name, p.full_name
             FROM org_memberships m
             JOIN profiles p ON p.id = m.user_id
            WHERE m.org_id = $1 AND m.status = 'active' AND m.role = 'learner'`,
          [orgId],
        ),
    // 6 · global personal streak — distinct Copenhagen activity-days for the
    //     caller across ALL orgs (a streak is a personal habit; self-data only).
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
    // 7 · per-day completions for the caller across both rolling windows (#455).
    //     Org-scoped like the rest of the hub (the streak above is the one
    //     deliberately global figure). duration_minutes is an authored estimate
    //     and nullable — summed as learning time, with the nulls counted, never
    //     coerced to a guess.
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
    // 8 · the hero's course cards — the learner's own courses, in-progress
    //     first and most recently opened first, so the tiles read as "pick this
    //     back up". Completed courses fill the remaining slots rather than
    //     leaving the slab lopsided: a learner who has finished everything is
    //     enrolled in everything, so the recommendations below come back empty
    //     for them and the hero would otherwise have nothing on its right.
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
    // 9 · "Courses learners love" — the hero's fallback when nothing is in
    //     progress. Ranked by platform-wide enrollment count (an anonymous
    //     aggregate; no member data crosses an org boundary), so the label is a
    //     real popularity signal rather than catalogue order. Courses the
    //     caller is already enrolled in are excluded.
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

  // Per-user XP maps from the org-scoped aggregates.
  const toMap = (rows: AggRow[]) => new Map(rows.map((r) => [r.user_id, r]));
  const lessons = toMap(lessonRows);
  const quizzes = toMap(quizRows);
  const courses = toMap(courseRows);
  const xpFor = (userId: string, window: 'all_time' | 'month') =>
    (lessons.get(userId)?.[window] ?? 0) * LESSON_XP +
    (quizzes.get(userId)?.[window] ?? 0) * QUIZ_XP +
    (courses.get(userId)?.[window] ?? 0) * COURSE_XP;

  // Leaderboard rows: learners only, but the caller's OWN xp is read from the
  // maps directly so it is correct even if the caller is not a ranked learner.
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
