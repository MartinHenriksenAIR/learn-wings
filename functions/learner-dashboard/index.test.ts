import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember, mockResolveVisibilityContext } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
    mockResolveVisibilityContext: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember }));
vi.mock('../shared/course-visibility', () => ({
  resolveVisibilityContext: mockResolveVisibilityContext,
  courseVisibilityPredicate: () => 'c.is_published = TRUE AND ORG_ACCESS($1)',
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const seedHappyPath = () => {
  mockQuery
    .mockResolvedValueOnce([{ started: 3, in_progress: 1, completed: 2 }])                 // 1 snapshot
    .mockResolvedValueOnce([{ user_id: 'p1', all_time: 5, month: 2 }, { user_id: 'p2', all_time: 10, month: 0 }]) // 2 lessons
    .mockResolvedValueOnce([{ user_id: 'p1', all_time: 1, month: 1 }])                     // 3 quizzes (distinct passed)
    .mockResolvedValueOnce([{ user_id: 'p2', all_time: 2, month: 0 }])                     // 4 courses
    .mockResolvedValueOnce([                                                               // 5 members (learners only)
      { user_id: 'p1', first_name: 'Martin', last_name: 'Henriksen', full_name: 'Martin Henriksen' },
      { user_id: 'p2', first_name: 'Anna', last_name: 'Berg', full_name: 'Anna Berg' },
    ])
    .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06', '2026-08-05', '2026-08-04'] }]) // 6 streak
    .mockResolvedValueOnce([                                                               // 7 per-day activity
      { day: '2026-08-06', lessons: 2, minutes: 30, untimed: 1 },
      { day: '2026-08-04', lessons: 1, minutes: 15, untimed: 0 },
      { day: '2026-07-28', lessons: 3, minutes: 60, untimed: 0 },                          // previous window
    ])
    .mockResolvedValueOnce([                                                               // 8 hero courses
      { id: 'c-1', title: 'AI in everyday work', thumbnail_url: 'lms/c1.png', lessons_total: 9, lessons_done: 4 },
    ])
    .mockResolvedValueOnce([                                                               // 9 recommendations
      { id: 'c-9', title: 'Prompt Engineering', thumbnail_url: null, lessons_total: 6, lessons_done: 0 },
    ]);
};

describe('learner-dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
    mockResolveVisibilityContext.mockResolvedValue({ isIndividual: false, language: 'da' });
    mockQueryOne.mockResolvedValue(null);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 403 for non-member and calls isActiveMember with correct args', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 200 with derived snapshot, XP, level, streak and org-scoped leaderboard', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    seedHappyPath();

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);

    expect(body.snapshot).toEqual({ started: 3, inProgress: 1, completed: 2, overallPct: 67 });

    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    expect(body.level.level).toBe(1);
    expect(body.level.xpToNext).toBe(125);

    expect(body.streak).toEqual({ current: 3, activeToday: true });

    expect(body.leaderboard.allTime.rows).toEqual([
      { rank: 1, name: 'Anna B.', xp: 300, isSelf: false },
      { rank: 2, name: 'Martin H.', xp: 75, isSelf: true },
    ]);
    expect(body.leaderboard.allTime.me).toEqual({ rank: 2, name: 'Martin H.', xp: 75, isSelf: true });
    expect(body.leaderboard.month.me.rank).toBe(1);
    expect(body.showLeaderboard).toBe(true);
  });

  it('derives the rolling seven-day window, its per-day series and the preceding week (#455)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    seedHappyPath();

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    const body = JSON.parse(res.body as string);

    expect(body.week.lessons).toBe(3);
    expect(body.week.minutes).toBe(45);
    expect(body.week.previous).toEqual({ lessons: 3, minutes: 60 });
    expect(body.week.perDayMinutes).toEqual([0, 0, 0, 0, 15, 0, 30]);
    expect(body.week.untimedLessons).toBe(1);
  });

  it('returns the in-progress hero courses and the recommendations behind the new-user hero (#455)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    seedHappyPath();

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    const body = JSON.parse(res.body as string);

    expect(body.courses).toEqual([
      { courseId: 'c-1', title: 'AI in everyday work', thumbnailUrl: 'lms/c1.png', lessonsTotal: 9, lessonsCompleted: 4, pct: 44 },
    ]);
    expect(body.recommended).toEqual([
      { courseId: 'c-9', title: 'Prompt Engineering', thumbnailUrl: null, lessonsTotal: 6, lessonsCompleted: 0, pct: 0 },
    ]);

    const calls = mockQuery.mock.calls as [string, unknown[]][];
    expect(calls[7][1]).toEqual(['org-1', 'p1']);
    expect(calls[7][0]).toContain("ORDER BY (e.status = 'enrolled') DESC");
    expect(calls[8][0]).toContain('NOT EXISTS');
    expect(calls[8][0]).toContain('JOIN lessons l ON l.module_id = cm.id');
    expect(calls[8][1]).toEqual(['org-1', 'da', 'p1']);
  });

  it('scopes every org query to orgId and derives the board from learners only', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    seedHappyPath();

    await handler(baseReq({ orgId: 'org-1' }), {} as any);

    const calls = mockQuery.mock.calls as [string, unknown[]][];
    expect(calls[0][1]).toEqual(['org-1', 'p1']);
    expect(calls[1][1]).toEqual(['org-1']);
    expect(calls[2][1]).toEqual(['org-1']);
    expect(calls[3][1]).toEqual(['org-1']);
    expect(calls[4][1]).toEqual(['org-1']);
    expect(calls[4][0]).toContain('org_memberships');
    expect(calls[4][0]).toContain("m.status = 'active'");
    expect(calls[4][0]).toContain("m.role = 'learner'");
    expect(calls[5][1]).toEqual(['p1']);
    expect(calls[5][0]).not.toContain('org_id');
  });

  it('returns 200 for platform admin without calling isActiveMember', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValue([]); // every derived query empty

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
    const body = JSON.parse(res.body as string);
    expect(body.xp).toEqual({ allTime: 0, month: 0 });
    expect(body.level.level).toBe(1);
    expect(body.streak).toEqual({ current: 0, activeToday: false });
    expect(body.leaderboard.allTime.rows).toEqual([]);
    expect(body.leaderboard.allTime.me).toBeNull();
  });

  it('suppresses the leaderboard for the individual tier but keeps personal XP/streak', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockResolveVisibilityContext.mockResolvedValueOnce({ isIndividual: true, language: 'da' });
    mockQuery
      .mockResolvedValueOnce([{ started: 3, in_progress: 1, completed: 2 }])                              // 1 snapshot
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 5, month: 2 }])                                  // 2 lessons
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 1, month: 1 }])                                  // 3 quizzes
      .mockResolvedValueOnce([])                                                                          // 4 courses
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06', '2026-08-05', '2026-08-04'] }]) // 5 streak (member query skipped)
      .mockResolvedValueOnce([])                                                                          // 6 per-day activity
      .mockResolvedValueOnce([])                                                                          // 7 hero courses
      .mockResolvedValueOnce([]);                                                                         // 8 recommendations

    const res = await handler(baseReq({ orgId: 'org-solo' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);

    expect(body.leaderboard).toEqual({
      allTime: { rows: [], me: null },
      month: { rows: [], me: null },
    });
    expect(body.showLeaderboard).toBe(false);

    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    expect(body.level.level).toBe(1);
    expect(body.streak).toEqual({ current: 3, activeToday: true });

    expect(mockResolveVisibilityContext).toHaveBeenCalledWith('org-solo', 'p1');
    const memberQueried = (mockQuery.mock.calls as [string, unknown[]][]).some(([sql]) => sql.includes('org_memberships'));
    expect(memberQueried).toBe(false);
  });

  it('suppresses the leaderboard when the org opted out (leaderboard_enabled=false) (#369)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ features: { leaderboard_enabled: false } });
    mockQuery
      .mockResolvedValueOnce([{ started: 1, in_progress: 0, completed: 1 }])          // 1 snapshot
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 5, month: 2 }])              // 2 lessons
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 1, month: 1 }])              // 3 quizzes
      .mockResolvedValueOnce([])                                                       // 4 courses
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06'] }])         // 5 streak
      .mockResolvedValueOnce([])                                                       // 6 per-day activity
      .mockResolvedValueOnce([])                                                       // 7 hero courses
      .mockResolvedValueOnce([]);                                                      // 8 recommendations

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.leaderboard).toEqual({
      allTime: { rows: [], me: null },
      month: { rows: [], me: null },
    });
    expect(body.showLeaderboard).toBe(false);
    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('org_settings'), ['org-1']);
    const memberQueried = (mockQuery.mock.calls as [string, unknown[]][]).some(([sql]) => sql.includes('org_memberships'));
    expect(memberQueried).toBe(false);
  });

  it('keeps the leaderboard when leaderboard_enabled is absent (default on) (#369)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ features: {} }); // key absent ⇒ enabled
    seedHappyPath();

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.leaderboard.allTime.rows.length).toBe(2);
  });

  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValue(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
