import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown, method: 'POST' | 'OPTIONS' = 'POST') => ({
  method,
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const EXPLICIT_COLS = 'id, org_id, email, role, status, expires_at, created_at, link_id';
const PROFILE_COLS = 'first_name, last_name, department';
const ORDER_CLAUSE = 'ORDER BY created_at DESC';

describe('invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  // 1. OPTIONS preflight
  it('returns 204 on OPTIONS preflight', async () => {
    const res = await handler(baseReq({}, 'OPTIONS'), {} as any);
    expect(res.status).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  // 2. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 3. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 4. 400 missing scope
  it('returns 400 when scope is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "platform"' });
  });

  // 5. 400 invalid scope value
  it('returns 400 when scope has an invalid value', async () => {
    const res = await handler(baseReq({ scope: 'self' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "platform"' });
  });

  // 6a. 400 scope=org missing orgId
  it('returns 400 when scope=org and orgId is missing', async () => {
    const res = await handler(baseReq({ scope: 'org' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required for scope=org' });
  });

  // 6b. 400 scope=org with non-string orgId
  it('returns 400 when scope=org and orgId is not a string', async () => {
    const res = await handler(baseReq({ scope: 'org', orgId: 42 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required for scope=org' });
  });

  // 6c. 400 scope=org with empty orgId
  it('returns 400 when scope=org and orgId is empty string', async () => {
    const res = await handler(baseReq({ scope: 'org', orgId: '' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required for scope=org' });
  });

  // 7. 403 scope=org caller is neither platform admin nor org admin
  it('returns 403 for scope=org when caller is not platform admin and not org admin', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // 8. 403 scope=platform caller is not platform admin
  it('returns 403 for scope=platform when caller is not platform admin', async () => {
    const res = await handler(baseReq({ scope: 'platform' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // 9. Happy path: scope=org as platform admin — NO invited_by_user_id filter, params=[orgId]
  it('scope=org platform admin returns 200 with no inviter filter', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [
      { id: 'inv1', org_id: 'org-1', email: 'a@x.com', role: 'learner', status: 'pending', expires_at: '2026-01-01', created_at: '2024-01-01', link_id: null, is_platform_admin_invite: false, invited_by_user_id: 'admin1', first_name: 'A', last_name: 'B', department: null },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitations: rows });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(EXPLICIT_COLS);
    expect(sql).toContain(PROFILE_COLS);
    expect(sql).not.toContain('token');
    expect(sql).toContain(`status = 'pending'`);
    expect(sql).toContain('org_id = $1');
    expect(sql).not.toMatch(/invited_by_user_id\s*=/);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(params).toEqual(['org-1']);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // 10. Happy path: scope=org as org admin — adds invited_by_user_id = $2, params = [orgId, profile.id]
  it('scope=org org admin returns 200 with inviter filter', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitations: [] });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(EXPLICIT_COLS);
    expect(sql).toContain(PROFILE_COLS);
    expect(sql).not.toContain('token');
    expect(sql).toContain(`status = 'pending'`);
    expect(sql).toContain('org_id = $1');
    expect(sql).toContain('invited_by_user_id = $2');
    expect(sql).toContain(ORDER_CLAUSE);
    expect(params).toEqual(['org-1', 'p1']);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  // 11. Happy path: scope=platform with orgId, platform admin — filters org_id, params=[orgId]
  it('scope=platform platform admin with orgId narrows by org_id', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ scope: 'platform', orgId: 'org-9' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitations: [] });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(EXPLICIT_COLS);
    expect(sql).toContain(PROFILE_COLS);
    expect(sql).not.toContain('token');
    expect(sql).toContain(`status = 'pending'`);
    expect(sql).toContain('org_id = $1');
    expect(sql).not.toMatch(/invited_by_user_id\s*=/);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(params).toEqual(['org-9']);
  });

  // 12. Happy path: scope=platform without orgId, platform admin — no org_id predicate, params=[]
  it('scope=platform platform admin without orgId returns all pending invitations', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [
      { id: 'inv1', org_id: 'org-1', email: 'a@x.com', role: 'learner', status: 'pending', expires_at: '2026-01-01', created_at: '2024-01-01', link_id: null, is_platform_admin_invite: false, invited_by_user_id: 'admin1', first_name: null, last_name: null, department: null },
      { id: 'inv2', org_id: null, email: 'b@x.com', role: 'platform_admin', status: 'pending', expires_at: '2026-01-01', created_at: '2024-01-02', link_id: null, is_platform_admin_invite: true, invited_by_user_id: 'admin1', first_name: null, last_name: null, department: null },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ scope: 'platform' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ invitations: rows });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(EXPLICIT_COLS);
    expect(sql).toContain(PROFILE_COLS);
    expect(sql).not.toContain('token');
    expect(sql).toContain(`status = 'pending'`);
    expect(sql).not.toMatch(/org_id\s*=/);
    expect(sql).not.toMatch(/invited_by_user_id\s*=/);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(params).toEqual([]);
  });

  // 13. 500 on db error
  it('returns 500 on db error', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ scope: 'platform' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
