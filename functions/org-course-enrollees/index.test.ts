import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('org-course-enrollees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  // 1. 401 when bearer token invalid
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 when profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 when orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 400 when courseId missing
  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  // 5. 403 for non-admin member
  it('returns 403 for non-admin member and calls isOrgAdmin with correct args', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  // 6. Happy path as org admin — SQL parity checks
  it('returns 200 with enrollee rows for org admin', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const rows = [
      { user_id: 'u1', full_name: 'Alice', status: 'enrolled', enrolled_at: '2024-01-01', completed_at: null },
      { user_id: 'u2', full_name: 'Bob', status: 'completed', enrolled_at: '2024-01-02', completed_at: '2024-02-01' },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.enrollees).toEqual(rows);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN profiles');
    expect(sql).toContain('WHERE e.org_id = $1 AND e.course_id = $2');
    expect(sql).toContain('ORDER BY p.full_name');
    expect(sql).not.toContain('entra_oid');
    expect(sql).not.toContain('SELECT *');
    expect(params).toEqual(['org-1', 'c-1']);
  });

  // 7. Platform-admin bypass — isOrgAdmin not called
  it('returns 200 for platform admin without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // 8. 500 on db error
  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'c-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // ── All-orgs aggregate (orgId 'all') — platform admins only ──────────────
  describe('all-orgs aggregate (orgId "all")', () => {
    it('returns 403 for a non-platform-admin (org admins stay isolated)', async () => {
      mockIsOrgAdmin.mockResolvedValue(true);

      const res = await handler(baseReq({ orgId: 'all', courseId: 'c-1' }), {} as any);

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('still 400s when courseId is missing', async () => {
      mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

      const res = await handler(baseReq({ orgId: 'all' }), {} as any);

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
    });

    it('lists distinct learners for a course across all orgs for a platform admin', async () => {
      mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
      const rows = [
        { user_id: 'u1', full_name: 'Alice', status: 'completed', enrolled_at: '2024-01-01', completed_at: '2024-02-01' },
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const res = await handler(baseReq({ orgId: 'all', courseId: 'c-1' }), {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string).enrollees).toEqual(rows);
      expect(mockIsOrgAdmin).not.toHaveBeenCalled();

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      // one row per learner even if enrolled through several orgs (unique React keys)
      expect(sql).toContain('DISTINCT ON');
      // filtered by course only — no org bind param
      expect(sql).toContain('e.course_id = $1');
      expect(sql).not.toContain('e.org_id');
      expect(params).toEqual(['c-1']);
    });
  });
});
