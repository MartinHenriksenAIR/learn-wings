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

describe('learner-courses', () => {
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

  // 5. Happy path — member, two courses, one enrollment
  it('returns 200 with courses and enrollments for a member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);

    const courseRows = [
      {
        id: 'c1', title: 'Alpha Course', description: 'Desc 1', level: 'beginner',
        is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-01',
      },
      {
        id: 'c2', title: 'Beta Course', description: 'Desc 2', level: 'intermediate',
        is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-02',
      },
    ];

    const enrollmentRows = [
      {
        id: 'e1', org_id: 'org-1', user_id: 'p1', course_id: 'c1',
        status: 'enrolled', enrolled_at: '2024-01-10', completed_at: null,
      },
    ];

    mockQuery
      .mockResolvedValueOnce(courseRows)      // courses query
      .mockResolvedValueOnce(enrollmentRows); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toEqual(courseRows);
    expect(body.enrollments).toEqual(enrollmentRows);

    // Assert courses SQL — access = 'enabled', is_published = TRUE, no SELECT *, params ['org-1']
    const [coursesSql, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesSql).toContain("access = 'enabled'");
    expect(coursesSql).toContain('c.is_published = TRUE');
    expect(coursesSql).not.toContain('SELECT *');
    expect(coursesParams).toEqual(['org-1']);

    // Assert enrollments SQL — user_id = $1, no SELECT *, params ['p1', 'org-1']
    const [enrollSql, enrollParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(enrollSql).toContain('user_id = $1');
    expect(enrollSql).not.toContain('SELECT *');
    expect(enrollParams).toEqual(['p1', 'org-1']);
  });

  // 6. Platform-admin bypass — isActiveMember NOT called
  it('returns 200 for platform admin without calling isActiveMember', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  // 7. 500 db error
  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
