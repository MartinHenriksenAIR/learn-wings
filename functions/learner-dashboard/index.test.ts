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
vi.mock('../shared/course-visibility', () => ({ resolveVisibilityContext: mockResolveVisibilityContext }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// The six derived queries, in the order getLearnerDashboardData issues them.
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
    .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06', '2026-08-05', '2026-08-04'] }]); // 6 streak
};

describe('learner-dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
    // Standard (non-individual) org by default so existing assertions hold.
    mockResolveVisibilityContext.mockResolvedValue({ isIndividual: false, language: 'da' });
    // No org_settings row by default ⇒ leaderboard enabled (the #369 default).
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

    // Snapshot counts + overall %.
    expect(body.snapshot).toEqual({ started: 3, inProgress: 1, completed: 2, overallPct: 67 });

    // Caller (p1) XP: 5·10 + 1·25 + 0·100 = 75 all-time; 2·10 + 1·25 = 45 this month.
    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    expect(body.level.level).toBe(1);
    expect(body.level.xpToNext).toBe(125);

    // Streak: three consecutive Copenhagen days ending today.
    expect(body.streak).toEqual({ current: 3, activeToday: true });

    // Leaderboard all-time: p2 (300) ranks above p1 (75); names are first + initial.
    expect(body.leaderboard.allTime.rows).toEqual([
      { rank: 1, name: 'Anna B.', xp: 300, isSelf: false },
      { rank: 2, name: 'Martin H.', xp: 75, isSelf: true },
    ]);
    expect(body.leaderboard.allTime.me).toEqual({ rank: 2, name: 'Martin H.', xp: 75, isSelf: true });
    // This month: p1 leads.
    expect(body.leaderboard.month.me.rank).toBe(1);
  });

  it('scopes every org query to orgId and derives the board from learners only', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    seedHappyPath();

    await handler(baseReq({ orgId: 'org-1' }), {} as any);

    const calls = mockQuery.mock.calls as [string, unknown[]][];
    // snapshot: (orgId, callerId)
    expect(calls[0][1]).toEqual(['org-1', 'p1']);
    // lessons / quizzes / courses / members: all filtered by orgId
    expect(calls[1][1]).toEqual(['org-1']);
    expect(calls[2][1]).toEqual(['org-1']);
    expect(calls[3][1]).toEqual(['org-1']);
    expect(calls[4][1]).toEqual(['org-1']);
    // members query: active learners only, joined from org_memberships (not client-supplied)
    expect(calls[4][0]).toContain('org_memberships');
    expect(calls[4][0]).toContain("m.status = 'active'");
    expect(calls[4][0]).toContain("m.role = 'learner'");
    // streak is global/personal — keyed by the caller, NOT by orgId (self-data)
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
    // Individual (self-serve) placeholder org — the board would pool unrelated
    // solo learners, so it must be suppressed at the backend (#373).
    mockResolveVisibilityContext.mockResolvedValueOnce({ isIndividual: true, language: 'da' });
    // Suppressed → the leaderboard-membership query (5) is NOT run, so only five
    // queries fire: snapshot, lessons, quizzes, courses, then streak.
    mockQuery
      .mockResolvedValueOnce([{ started: 3, in_progress: 1, completed: 2 }])                              // 1 snapshot
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 5, month: 2 }])                                  // 2 lessons
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 1, month: 1 }])                                  // 3 quizzes
      .mockResolvedValueOnce([])                                                                          // 4 courses
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06', '2026-08-05', '2026-08-04'] }]); // 5 streak (member query skipped)

    const res = await handler(baseReq({ orgId: 'org-solo' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);

    // No stranger data crosses the wire — both windows are empty, me is null.
    expect(body.leaderboard).toEqual({
      allTime: { rows: [], me: null },
      month: { rows: [], me: null },
    });

    // The solo learner still gets their own XP, level and streak.
    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    expect(body.level.level).toBe(1);
    expect(body.streak).toEqual({ current: 3, activeToday: true });

    // Detection is via the resolver (kind='individual'), never a hard-coded id.
    expect(mockResolveVisibilityContext).toHaveBeenCalledWith('org-solo', 'p1');
    // The org_memberships (leaderboard) query must never have run.
    const memberQueried = (mockQuery.mock.calls as [string, unknown[]][]).some(([sql]) => sql.includes('org_memberships'));
    expect(memberQueried).toBe(false);
  });

  it('suppresses the leaderboard when the org opted out (leaderboard_enabled=false) (#369)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    // Standard org, but the leaderboard is turned off in org_settings.features.
    mockQueryOne.mockResolvedValueOnce({ features: { leaderboard_enabled: false } });
    // Suppressed → member query (5) skipped: snapshot, lessons, quizzes, courses, streak.
    mockQuery
      .mockResolvedValueOnce([{ started: 1, in_progress: 0, completed: 1 }])          // 1 snapshot
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 5, month: 2 }])              // 2 lessons
      .mockResolvedValueOnce([{ user_id: 'p1', all_time: 1, month: 1 }])              // 3 quizzes
      .mockResolvedValueOnce([])                                                       // 4 courses
      .mockResolvedValueOnce([{ today: '2026-08-06', days: ['2026-08-06'] }]);        // 5 streak

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    // No member data crosses the wire — both windows empty, me null.
    expect(body.leaderboard).toEqual({
      allTime: { rows: [], me: null },
      month: { rows: [], me: null },
    });
    // Personal XP/streak are still derived.
    expect(body.xp).toEqual({ allTime: 75, month: 45 });
    // The org_settings feature read ran, scoped to the org.
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('org_settings'), ['org-1']);
    // The org_memberships (leaderboard) query must never have run.
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
