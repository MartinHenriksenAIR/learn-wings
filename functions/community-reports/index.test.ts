import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const sampleReport = {
  id: 'r1',
  reporter_user_id: 'p2',
  target_type: 'post',
  target_id: 't1',
  org_id: 'org-1',
  reason: 'spam',
  status: 'pending',
  reporter: { id: 'p2', full_name: 'Bob' },
  reviewer: null,
};

describe('community-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
    mockQuery.mockResolvedValue([sampleReport]);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is present but not a string', async () => {
    const res = await handler(baseReq({ orgId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId must be a string' });
  });

  it('returns 400 when scope is present but not "global"', async () => {
    const res = await handler(baseReq({ scope: 'org' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "scope must be 'global'" });
  });

  it('returns 400 when status is an invalid value', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', status: 'open' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "status must be 'pending', 'reviewed', or 'dismissed'" });
  });

  it('returns 400 when both orgId and scope are provided', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', scope: 'global' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Provide orgId or scope, not both' });
  });

  // orgId mode — non-admin (neither platform admin nor org admin) → 403
  it('returns 403 when non-admin requests org reports', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // scope: global — non-platform-admin → 403
  it('returns 403 when org admin requests global scope', async () => {
    mockIsOrgAdmin.mockResolvedValue(true); // is org admin but NOT platform admin
    const res = await handler(baseReq({ scope: 'global' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    // isOrgAdmin should NOT be called for global scope
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // neither orgId nor scope — non-platform-admin → 403 (documented deviation)
  it('returns 403 when non-platform-admin requests without filter', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // org admin with orgId → 200
  it('happy path: org admin can list reports for their org', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ reports: [sampleReport] });

    const queryCall = mockQuery.mock.calls[0] as [string, unknown[]];
    const [sql, params] = queryCall;
    expect(sql).toContain('FROM community_reports r');
    expect(sql).toContain('JOIN profiles rep');
    expect(sql).toContain('LEFT JOIN profiles rev');
    expect(sql).toContain('ORDER BY r.created_at DESC');
    expect(sql).toContain('r.org_id =');
    expect(params).toContain('org-1');
  });

  // #86: comment targets carry the parent post id so moderation UIs can
  // deep-link /posts/<post_id>#comment-<target_id>.
  it('projection joins out the parent post id for comment targets', async () => {
    const commentReport = {
      ...sampleReport,
      id: 'r2',
      target_type: 'comment',
      target_id: 'c1',
      post_id: 'post-9',
    };
    mockQuery.mockResolvedValueOnce([commentReport]);
    mockIsOrgAdmin.mockResolvedValueOnce(true);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ reports: [commentReport] });

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('LEFT JOIN community_comments tc');
    expect(sql).toContain("r.target_type = 'comment' AND tc.id = r.target_id");
    expect(sql).toMatch(/CASE WHEN r\.target_type = 'comment' THEN tc\.post_id ELSE NULL END AS post_id/);
  });

  // platform admin with orgId — isOrgAdmin NOT called
  it('platform admin can list reports without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // platform admin with scope: global
  it('platform admin can list global scope reports', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({ scope: 'global' }), {} as any);
    expect(res.status).toBe(200);
    const queryCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryCall[0]).toContain('r.org_id IS NULL');
  });

  // platform admin with no filter
  it('platform admin can list all reports without filter', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(200);
    const queryCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryCall[0]).not.toContain('WHERE');
  });

  // status filter applied
  it('applies status filter when provided', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ orgId: 'org-1', status: 'pending' }), {} as any);
    expect(res.status).toBe(200);
    const queryCall = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(queryCall[0]).toContain('r.status =');
    expect(queryCall[1]).toContain('pending');
  });

  it('returns 500 on db error', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({}), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
