import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('org-memberships', () => {
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

  // 3a. 400 when orgId missing
  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  // 3b. 400 when orgId is not a string
  it('returns 400 when orgId is not a string', async () => {
    const res = await handler(baseReq({ orgId: 42 }), {} as any);

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

  // 5. Happy path as org admin
  it('returns 200 with memberships for org admin', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const rows = [
      { id: 'm1', org_id: 'org-1', user_id: 'u1', role: 'learner', status: 'active', created_at: '2024-01-01', full_name: 'Alice', email: 'alice@x.com', avatar_url: null, department: null },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.memberships).toEqual(rows);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN profiles');
    expect(sql).toContain('WHERE om.org_id = $1');
    expect(params).toEqual(['org-1']);
    expect(sql).not.toContain('entra_oid');
    // Roster semantics: no status filter in WHERE clause
    expect(sql).not.toMatch(/WHERE.*om\.status/);
  });

  // 6. Platform admin bypass
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
