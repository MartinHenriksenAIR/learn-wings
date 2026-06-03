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

describe('org-course-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  // 1. 401 when bearer token invalid
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 when profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 when orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 4. 403 for non-admin member
  it('returns 403 for non-admin member and calls isOrgAdmin with correct args', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  // 5. Happy path as org admin — SQL parity checks
  it('returns 200 with course progress rows for org admin', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const rows = [{ id: 'c1', title: 'A', level: 'basic', enrolled: 4, completed: 2 }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toEqual(rows);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEFT JOIN enrollments');
    expect(sql).toContain('FILTER (WHERE e.status = \'completed\')');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('oca.access = \'enabled\'');
    expect(sql).toContain('ORDER BY c.title');
    // Parity: no is_published filter
    expect(sql).not.toContain('is_published');
    // No SELECT *
    expect(sql).not.toContain('SELECT *');
    expect(params).toEqual(['org-1']);
  });

  // 6. Platform admin bypass — isOrgAdmin not called
  it('returns 200 for platform admin without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // 7. 500 on db error
  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
