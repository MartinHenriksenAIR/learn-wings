import { query } from './db';

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

export interface LearnerDashboardData {
  snapshot: { started: number; inProgress: number; completed: number; overallPct: number };
  xp: { allTime: number; month: number };
  level: LevelInfo;
  streak: { current: number; activeToday: boolean };
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
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
  opts?: { suppressLeaderboard?: boolean },
): Promise<LearnerDashboardData> {
  const [snapshotRows, lessonRows, quizRows, courseRows, memberRows, streakRows] = await Promise.all([
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
    leaderboard: opts?.suppressLeaderboard
      ? { allTime: { rows: [], me: null }, month: { rows: [], me: null } }
      : { allTime: rankWindow(learnersAllTime, callerId), month: rankWindow(learnersMonth, callerId) },
  };
}
