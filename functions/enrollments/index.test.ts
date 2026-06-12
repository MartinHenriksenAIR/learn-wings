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

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const EXPLICIT_COLS = 'id, org_id, user_id, course_id, status, enrolled_at, completed_at';
const ORDER_CLAUSE = 'ORDER BY enrolled_at DESC';

describe('enrollments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 when a provided field is wrong type
  it('returns 400 when orgId is not a string', async () => {
    const res = await handler(baseReq({ orgId: 42 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId must be a string' });
  });

  it('returns 400 when userId is not a string', async () => {
    const res = await handler(baseReq({ userId: 99 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId must be a string' });
  });

  it('returns 400 when courseId is not a string', async () => {
    const res = await handler(baseReq({ courseId: false }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId must be a string' });
  });

  // 4. Platform admin, no filters → 200; SQL has NO WHERE; params []
  it('platform admin with no filters returns all enrollments — no WHERE, no SELECT *', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'e1', org_id: 'org-1', user_id: 'u1', course_id: 'c1', status: 'enrolled', enrolled_at: '2024-01-01', completed_at: null }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.enrollments).toEqual(rows);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(EXPLICIT_COLS);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(params ?? []).toEqual([]);
  });

  // 5. Platform admin, all three filters → SQL contains org_id = $1, user_id = $2, course_id = $3
  it('platform admin with all three filters applies them in order', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1', userId: 'u-9', courseId: 'c-3' }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('org_id = $1');
    expect(sql).toContain('user_id = $2');
    expect(sql).toContain('course_id = $3');
    expect(params).toEqual(['org-1', 'u-9', 'c-3']);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(sql).toContain(EXPLICIT_COLS);
  });

  // 6. Org-admin scope: non-admin profile + orgId + userId + isOrgAdmin true
  it('org-admin scope: applies org_id and user_id filters, calls isOrgAdmin correctly', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1', userId: 'u-9' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('org_id = $1');
    expect(sql).toContain('user_id = $2');
    expect(params).toEqual(['org-1', 'u-9']);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(sql).toContain(EXPLICIT_COLS);
  });

  // 7. Self scope ignores client userId
  it('self scope ignores client-supplied userId, forces own profile.id', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({ orgId: 'org-1', userId: 'evil-user' }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // user_id is added first (profile.id forced), then org_id — pinned positional order
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('org_id = $2');
    expect(params).toEqual(['p1', 'org-1']);
    expect(params).not.toContain('evil-user');
    expect(sql).toContain(ORDER_CLAUSE);
    expect(sql).toContain(EXPLICIT_COLS);
  });

  // 8. Self scope, no filters → SQL WHERE user_id = $1, params ['p1']
  it('self scope with no filters forces user_id = profile.id only', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE user_id = $1');
    expect(params).toEqual(['p1']);
    expect(sql).toContain(ORDER_CLAUSE);
    expect(sql).toContain(EXPLICIT_COLS);
  });

  // 9. 500 db error
  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({}), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
