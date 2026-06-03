import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQuery: vi.fn(), mockQueryOne: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
  });

  // 1. 401 when bearer token invalid
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 when profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // getProfile returns null

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. List all orgs as platform admin
  it('returns all organizations for platform admin (no JOIN)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true }); // getProfile
    mockQuery.mockResolvedValueOnce([{ id: 'org-1' }, { id: 'org-2' }]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organizations).toHaveLength(2);

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('JOIN org_memberships');
  });

  // 4. List orgs as regular member
  it('returns member orgs for non-admin user via JOIN on org_memberships', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false }); // getProfile
    mockQuery.mockResolvedValueOnce([{ id: 'org-1' }]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organizations).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('org_memberships');
    expect(sql).toContain("status = 'active'");
    expect(params).toEqual(['p1']);
  });

  // 5. Single org as active member
  it('returns single organization for active member', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p2', is_platform_admin: false }); // getProfile
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // isActiveMember
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', name: 'X' }); // org row

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organization).toMatchObject({ id: 'org-1', name: 'X' });
  });

  // 6. Single org 403 for non-member non-admin
  it('returns 403 when requester is non-member non-admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p3', is_platform_admin: false }); // getProfile
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // isActiveMember returns false

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // 7. Single org 404 when org not found
  it('returns 404 when organization does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'p4', is_platform_admin: false }); // getProfile
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // isActiveMember
    mockQueryOne.mockResolvedValueOnce(null); // org not found

    const res = await handler(baseReq({ orgId: 'org-missing' }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization not found' });
  });

  // 8. 500 on db error during profile lookup
  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
