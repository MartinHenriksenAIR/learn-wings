import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('learner-dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 403 non-member — isActiveMember called with ('p1','org-1')
  it('returns 403 for non-member and calls isActiveMember with correct args', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  // 5. Happy path — member, two enrollments, zero-fill proven
  it('returns 200 with correct progress including zero-fill for missing courses', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);

    const enrollmentRows = [
      {
        id: 'e1', org_id: 'org-1', user_id: 'p1', course_id: 'c1',
        status: 'enrolled', enrolled_at: '2024-01-01', completed_at: null,
        course: { id: 'c1', title: 'Course 1', description: null, level: 'beginner',
                  is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-01' },
      },
      {
        id: 'e2', org_id: 'org-1', user_id: 'p1', course_id: 'c2',
        status: 'enrolled', enrolled_at: '2024-01-02', completed_at: null,
        course: { id: 'c2', title: 'Course 2', description: null, level: 'intermediate',
                  is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-02' },
      },
    ];

    // totals: only c1 has lessons, c2 has none
    const totalsRows = [{ course_id: 'c1', total: 5 }];
    // completed: only c1 has progress, c2 has none
    const completedRows = [{ course_id: 'c1', completed: 3 }];

    mockQuery
      .mockResolvedValueOnce(enrollmentRows) // enrollments query
      .mockResolvedValueOnce(totalsRows)      // totals query
      .mockResolvedValueOnce(completedRows);  // completed query

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);

    expect(body.enrollments).toEqual(enrollmentRows);
    // Zero-fill proven: c2 has 0/0
    expect(body.progress).toEqual({
      c1: { total: 5, completed: 3 },
      c2: { total: 0, completed: 0 },
    });

    // Assert enrollment SQL — user_id scoped to profile.id, not raw oid
    const [enrollSql, enrollParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(enrollSql).toContain('e.user_id = $1');
    expect(enrollSql).toContain('e.org_id = $2');
    expect(enrollSql).toContain('json_build_object');
    expect(enrollParams).toEqual(['p1', 'org-1']);

    // Assert totals SQL and params
    const [totalsSql, totalsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(totalsSql).toContain('ANY($1::uuid[])');
    expect(totalsParams).toEqual([['c1', 'c2']]);

    // Assert completed SQL and params
    const [completedSql, completedParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(completedSql).toContain("lp.status = 'completed'");
    expect(completedSql).toContain('ANY($3::uuid[])');
    expect(completedParams).toEqual(['p1', 'org-1', ['c1', 'c2']]);
  });

  // 6. Zero enrollments early exit — only one query runs
  it('returns 200 early with empty data when no enrollments', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]); // empty enrollments

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ enrollments: [], progress: {} });

    // Only the one enrollment query ran — no totals or completed queries
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  // 7. Platform-admin bypass — isActiveMember NOT called
  it('returns 200 for platform admin without calling isActiveMember', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]); // no enrollments

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  // 8. 500 db error
  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
