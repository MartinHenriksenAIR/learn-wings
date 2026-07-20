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

describe('organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
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
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. List all orgs as platform admin
  it('returns all organizations for platform admin (no outer JOIN) with member_count and pending_invite_count', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([
      { id: 'org-1', member_count: 5, pending_invite_count: 2 },
      { id: 'org-2', member_count: 0, pending_invite_count: 0 },
    ]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organizations).toHaveLength(2);
    expect(body.organizations[0]).toMatchObject({ id: 'org-1', member_count: 5, pending_invite_count: 2 });
    expect(body.organizations[1]).toMatchObject({ id: 'org-2', member_count: 0, pending_invite_count: 0 });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // Platform-admin branch has NO outer JOIN to org_memberships — only the inline subquery
    expect(sql).not.toContain('JOIN org_memberships');
    expect(sql).toContain('member_count');
    expect(sql).toContain('org_memberships om2');
    expect(sql).toContain('pending_invite_count');
    expect(sql).toContain("i.status = 'pending'");
    expect(sql).toContain('ORDER BY o.created_at DESC');
    expect(params ?? []).toEqual([]);
  });

  // 4. List orgs as regular member
  it('returns member orgs for non-admin user via JOIN on org_memberships with member_count and pending_invite_count', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'org-1', member_count: 3, pending_invite_count: 1 }]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]).toMatchObject({ id: 'org-1', member_count: 3, pending_invite_count: 1 });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN org_memberships om');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('member_count');
    // Subquery alias must differ from outer JOIN alias to avoid collision
    expect(sql).toContain('org_memberships om2');
    expect(sql).toContain('pending_invite_count');
    expect(sql).toContain("i.status = 'pending'");
    expect(sql).toContain('ORDER BY o.created_at DESC');
    expect(params).toEqual(['p1']);
  });

  // 4b. member_count is returned as a number, not a string (documents the ::int cast intent)
  it('returns member_count as integer, not string', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([{ id: 'org-1', member_count: 3 }]);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organizations[0].member_count).toBe(3);
    expect(typeof body.organizations[0].member_count).toBe('number');

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('COUNT(*)::int');
  });

  // 5. Single org as active member
  it('returns single organization for active member with member_count and pending_invite_count', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', name: 'X', member_count: 4, pending_invite_count: 2 });

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organization).toMatchObject({ id: 'org-1', name: 'X', member_count: 4, pending_invite_count: 2 });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('org_memberships om2');
    expect(sql).toContain("om2.status = 'active'");
    expect(sql).toContain('member_count');
    expect(sql).toContain("i.status = 'pending'");
    expect(sql).toContain('pending_invite_count');
    expect(params).toEqual(['org-1']);
  });

  // 6. Single org 403 for non-member non-admin
  it('returns 403 when requester is non-member non-admin', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // 7. Single org 404 when org not found
  it('returns 404 when organization does not exist', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-missing' }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization not found' });
  });

  // 8. 500 on db error
  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({}), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // 9. Platform admin + orgId bypasses membership check
  it('returns org for platform admin without calling isActiveMember', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', name: 'Admin Org' });

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.organization).toMatchObject({ id: 'org-1', name: 'Admin Org' });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });
});
