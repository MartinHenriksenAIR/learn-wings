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

describe('org-course-org-breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for a non-platform-admin and never queries', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(true); // even a genuine org admin must not reach cross-org data

    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 200 with per-org rows for a platform admin', async () => {
    const rows = [
      { org_id: 'o1', org_name: 'Acme', enrolled: 64, completed: 20 },
      { org_id: 'o2', org_name: 'Globex', enrolled: 51, completed: 12 },
      { org_id: 'o3', org_name: 'Umbrella', enrolled: 0, completed: 0 },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string).orgs).toEqual(rows);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM organizations o');
    expect(sql).toContain('UNION');
    expect(sql).toContain("oca.access = 'enabled'");
    expect(sql).toContain('LEFT JOIN enrollments');
    expect(sql).toContain('WITH grp AS');
    expect(sql).toContain('COALESCE(gm.course_group_id, gm.id)');
    expect(sql).toContain('IN (SELECT id FROM grp)');
    expect(sql).toContain('COUNT(DISTINCT e.user_id)');
    expect(sql).toContain("FILTER (WHERE e.status = 'completed')");
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('ORDER BY enrolled DESC');
    expect(sql).not.toContain('SELECT *');
    expect(params).toEqual(['c-1']);
  });

  it('#354: excludes the Individuals placeholder org from the cross-org breakdown', async () => {
    mockQuery.mockResolvedValueOnce([{ org_id: 'o1', org_name: 'Acme', enrolled: 3, completed: 1 }]);

    const res = await handler(baseReq({ courseId: 'c-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("o.kind <> 'individual'");
  });

  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ courseId: 'c-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
