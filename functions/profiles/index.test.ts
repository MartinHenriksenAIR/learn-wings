import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
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

  // 3. 400 when userIds is not an array of strings
  it('returns 400 when userIds is not an array of strings', async () => {
    const res = await handler(baseReq({ userIds: 'abc' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userIds must be an array of strings' });
  });

  // 4. Platform admin, no filter — no JOIN, no WHERE, no entra_oid
  it('returns all profiles for platform admin without filter', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'u1', full_name: 'Alice' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profiles).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[] | undefined];
    expect(sql).not.toContain('JOIN');
    expect(sql).not.toContain('WHERE');
    expect(sql).not.toContain('entra_oid');
    expect(params ?? []).toEqual([]);
  });

  // 5. Platform admin with userIds — SQL has ANY($1::uuid[])
  it('returns filtered profiles for platform admin with userIds', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'u1', full_name: 'Alice' }, { id: 'u2', full_name: 'Bob' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ userIds: ['u1', 'u2'] }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profiles).toHaveLength(2);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ANY($1::uuid[])');
    expect(params).toEqual([['u1', 'u2']]);
  });

  // 6. Org admin tier
  it('returns org-scoped profiles for org admin', async () => {
    // Non-platform-admin profile
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    // EXISTS check for org admin role → true
    mockQueryOne.mockResolvedValueOnce({ ok: true });
    const rows = [{ id: 'u2', full_name: 'Bob' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profiles).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("my.role = 'org_admin'");
    expect(params[0]).toBe('p1');
  });

  // 7. Learner tier — returns own profile only, ignores userIds
  it('returns own profile only for learner, even when userIds provided', async () => {
    // Non-platform-admin profile
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    // EXISTS check for org admin role → false
    mockQueryOne.mockResolvedValueOnce({ ok: false });
    const rows = [{ id: 'p1', full_name: 'Self' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ userIds: ['other-user'] }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profiles).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $1');
    expect(params).toEqual(['p1']);
  });

  // 8. 500 on db error
  it('returns 500 on db error', async () => {
    // Non-platform-admin profile
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    // EXISTS check throws
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
