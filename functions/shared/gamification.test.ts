import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('./db', () => ({ query: mockQuery, queryOne: vi.fn() }));

import {
  levelThreshold,
  levelForXp,
  levelProgress,
  displayName,
  computeStreak,
  buildWeekActivity,
  getLearnerDashboardData,
  LESSON_XP,
  QUIZ_XP,
  COURSE_XP,
} from './gamification';

describe('level math', () => {
  it('has the documented rising thresholds', () => {
    expect([1, 2, 3, 4, 5].map(levelThreshold)).toEqual([0, 200, 500, 900, 1400]);
  });

  it('maps XP to the correct level at and around each boundary', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
    expect(levelForXp(499)).toBe(2);
    expect(levelForXp(500)).toBe(3);
    expect(levelForXp(1400)).toBe(5);
    expect(levelForXp(-50)).toBe(1); // never below 1
  });

  it('reports progress within a level', () => {
    const p = levelProgress(75);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(75);
    expect(p.xpForLevel).toBe(200);
    expect(p.xpToNext).toBe(125);
    expect(p.nextThreshold).toBe(200);
    expect(p.progressPct).toBe(38);
  });
});

describe('displayName', () => {
  it('is first name + last initial', () => {
    expect(displayName({ first_name: 'Martin', last_name: 'Henriksen', full_name: 'Martin Henriksen' })).toBe('Martin H.');
  });
  it('derives from full_name when first/last are absent', () => {
    expect(displayName({ first_name: null, last_name: null, full_name: 'Anna Berg' })).toBe('Anna B.');
  });
  it('handles a single-token name (no initial)', () => {
    expect(displayName({ first_name: 'Cher', last_name: null, full_name: 'Cher' })).toBe('Cher');
  });
});

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreak('2026-08-06', ['2026-08-06', '2026-08-05', '2026-08-04'])).toEqual({ current: 3, activeToday: true });
  });
  it('stays alive if the last active day was yesterday (grace)', () => {
    expect(computeStreak('2026-08-06', ['2026-08-05', '2026-08-04'])).toEqual({ current: 2, activeToday: false });
  });
  it('is broken (0) when the last active day is older than yesterday', () => {
    expect(computeStreak('2026-08-06', ['2026-08-03', '2026-08-02'])).toEqual({ current: 0, activeToday: false });
  });
  it('crosses month boundaries correctly', () => {
    expect(computeStreak('2026-08-01', ['2026-08-01', '2026-07-31', '2026-07-30'])).toEqual({ current: 3, activeToday: true });
  });
  it('handles no activity', () => {
    expect(computeStreak('2026-08-06', [])).toEqual({ current: 0, activeToday: false });
  });
});

describe('XP rates', () => {
  it('are the agreed values', () => {
    expect([LESSON_XP, QUIZ_XP, COURSE_XP]).toEqual([10, 25, 100]);
  });
});

describe('getLearnerDashboardData suppressLeaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the member query and returns empty windows, keeping personal XP/streak', async () => {
    mockQuery
      .mockResolvedValueOnce([{ started: 2, in_progress: 1, completed: 1 }])   // snapshot
      .mockResolvedValueOnce([{ user_id: 'me', all_time: 5, month: 2 }])        // lessons
      .mockResolvedValueOnce([{ user_id: 'me', all_time: 1, month: 1 }])        // quizzes
      .mockResolvedValueOnce([])                                               // courses
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06'] }])   // streak
      .mockResolvedValueOnce([])                                               // per-day activity
      .mockResolvedValueOnce([])                                               // hero courses
      .mockResolvedValueOnce([]);                                              // recommendations

    const data = await getLearnerDashboardData('org-solo', 'me', { suppressLeaderboard: true });

    expect(mockQuery).toHaveBeenCalledTimes(8);
    const memberQueried = (mockQuery.mock.calls as [string, unknown[]][]).some(([sql]) => sql.includes('org_memberships'));
    expect(memberQueried).toBe(false);

    expect(data.leaderboard).toEqual({
      allTime: { rows: [], me: null },
      month: { rows: [], me: null },
    });

    expect(data.xp).toEqual({ allTime: 75, month: 45 });
    expect(data.level.level).toBe(1);
    expect(data.streak).toEqual({ current: 1, activeToday: true });
  });

  it('runs the member query and ranks the board when not suppressed', async () => {
    mockQuery
      .mockResolvedValueOnce([{ started: 1, in_progress: 0, completed: 1 }])   // snapshot
      .mockResolvedValueOnce([{ user_id: 'me', all_time: 5, month: 2 }])        // lessons
      .mockResolvedValueOnce([])                                               // quizzes
      .mockResolvedValueOnce([])                                               // courses
      .mockResolvedValueOnce([{ user_id: 'me', first_name: 'Solo', last_name: 'Learner', full_name: 'Solo Learner' }]) // members
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06'] }])   // streak
      .mockResolvedValueOnce([])                                               // per-day activity
      .mockResolvedValueOnce([])                                               // hero courses
      .mockResolvedValueOnce([]);                                              // recommendations

    const data = await getLearnerDashboardData('org-1', 'me');

    expect(mockQuery).toHaveBeenCalledTimes(9);
    const memberQueried = (mockQuery.mock.calls as [string, unknown[]][]).some(([sql]) => sql.includes('org_memberships'));
    expect(memberQueried).toBe(true);
    expect(data.leaderboard.allTime.rows).toEqual([{ rank: 1, name: 'Solo L.', xp: 50, isSelf: true }]);
  });
});

describe('buildWeekActivity (#455)', () => {
  const day = (d: string, lessons: number, minutes: number, untimed = 0) =>
    ({ day: d, lessons, minutes, untimed });

  it('splits the rows into the current seven days and the seven before them', () => {
    const week = buildWeekActivity('2026-08-06', [
      day('2026-08-06', 2, 30, 1),
      day('2026-08-04', 1, 15),
      day('2026-07-31', 1, 20),   // oldest day still inside the current window
      day('2026-07-30', 4, 45),   // first day of the previous window
      day('2026-07-24', 1, 15),   // oldest day of the previous window
      day('2026-07-23', 9, 999),  // outside both — must be ignored
    ]);

    expect(week.lessons).toBe(4);
    expect(week.minutes).toBe(65);
    expect(week.untimedLessons).toBe(1);
    expect(week.previous).toEqual({ lessons: 5, minutes: 60 });
  });

  it('emits one value per day, oldest first, zero-filling the quiet ones', () => {
    const week = buildWeekActivity('2026-08-06', [day('2026-08-06', 1, 30), day('2026-08-03', 1, 10)]);
    expect(week.perDayMinutes).toEqual([0, 0, 0, 10, 0, 0, 30]);
  });

  it('returns a flat window rather than NaNs when there is no anchor date', () => {
    const week = buildWeekActivity('', [day('2026-08-06', 1, 30)]);
    expect(week.perDayMinutes).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(week).toMatchObject({ lessons: 0, minutes: 0, previous: { lessons: 0, minutes: 0 } });
  });
});
