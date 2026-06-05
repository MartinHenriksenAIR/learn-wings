import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('community-posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ scope: 'global' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ scope: 'global' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when scope is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "global"' });
  });

  it('returns 400 when scope is invalid', async () => {
    const res = await handler(baseReq({ scope: 'invalid' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "global"' });
  });

  it('returns 400 when scope=org and orgId is missing', async () => {
    const res = await handler(baseReq({ scope: 'org' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required for org scope' });
  });

  it('returns 400 when categoryId is wrong type', async () => {
    const res = await handler(baseReq({ scope: 'global', categoryId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId must be a string' });
  });

  it('returns 400 when search is wrong type', async () => {
    const res = await handler(baseReq({ scope: 'global', search: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'search must be a string' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ scope: 'global', tags: [1, 2] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 403 when scope=org and caller is not a member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 200 with posts for global scope (no auth check beyond profile)', async () => {
    const rows = [{ id: 'post-1', title: 'Hello', scope: 'global' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ scope: 'global' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ posts: rows });
    expect(mockIsActiveMember).not.toHaveBeenCalled();

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('community_posts');
    expect(sql).toContain('p.is_hidden = false');
    expect(params).toContain('global');
  });

  it('returns 200 with hidden posts when org admin', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const rows = [{ id: 'post-1', is_hidden: true }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    // The WHERE clause should not filter by p.is_hidden for admins
    expect(sql).not.toContain('p.is_hidden = false');
  });

  it('returns 200 filtering by categoryId', async () => {
    const rows: unknown[] = [];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ scope: 'global', categoryId: 'cat-1' }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('category_id');
    expect(params).toContain('cat-1');
  });

  it('returns 200 filtering by search', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ scope: 'global', search: 'hello' }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ILIKE');
    expect(params).toContain('hello');
  });

  it('returns 200 filtering by tags', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ scope: 'global', tags: ['tag1', 'tag2'] }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('&&');
    // tags is passed as a JS array directly; find it in params
    const tagsParam = params.find((p) => Array.isArray(p) && (p as string[]).includes('tag1'));
    expect(tagsParam).toEqual(['tag1', 'tag2']);
  });

  it('platform admin bypasses isActiveMember for org scope', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('platform admin sees hidden posts (SQL WHERE has no p.is_hidden = false)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ scope: 'global' }), {} as any);
    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    // p.is_hidden = false should not appear in the WHERE clause for admins
    expect(sql).not.toContain('p.is_hidden = false');
  });

  it('combined filter: org scope + categoryId + search + tags as org admin (includeHidden=true)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);

    const res = await handler(
      baseReq({ scope: 'org', orgId: 'org-1', categoryId: 'cat-1', search: 'foo', tags: ['a', 'b'] }),
      {} as any,
    );

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

    // Full params array in builder order:
    // $1=scope, $2=orgId, $3=categoryId, $4=search, $5=tags, $6=includeHidden
    expect(params).toEqual(['org', 'org-1', 'cat-1', 'foo', ['a', 'b'], true]);

    // SQL must contain ILIKE and && fragments
    expect(sql).toContain('ILIKE');
    expect(sql).toContain('&&');

    // includeHidden=true means p.is_hidden = false must NOT appear in the WHERE clause
    // (the comment_count subquery's cc.is_hidden = false will still be present)
    expect(sql).not.toContain('p.is_hidden = false');
  });

  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ scope: 'org', orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
