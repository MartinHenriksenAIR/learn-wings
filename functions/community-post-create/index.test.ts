import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validGlobalBody = {
  scope: 'global',
  categoryId: 'cat-1',
  title: 'My Post',
  content: 'Post content here',
};

const validOrgBody = {
  scope: 'org',
  orgId: 'org-1',
  categoryId: 'cat-1',
  title: 'Org Post',
  content: 'Org content',
};

describe('community-post-create', () => {
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
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when scope is missing', async () => {
    const res = await handler(baseReq({ categoryId: 'cat-1', title: 'x', content: 'y' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "global"' });
  });

  it('returns 400 when scope is invalid', async () => {
    const res = await handler(baseReq({ ...validGlobalBody, scope: 'private' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'scope must be "org" or "global"' });
  });

  it('returns 400 when scope=org and orgId is missing', async () => {
    const res = await handler(baseReq({ scope: 'org', categoryId: 'cat-1', title: 'x', content: 'y' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required for org scope' });
  });

  it('returns 400 when scope=global and orgId is provided', async () => {
    const res = await handler(baseReq({ ...validGlobalBody, orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId must not be provided for global scope' });
  });

  it('returns 400 when categoryId is missing', async () => {
    const { categoryId: _c, ...body } = validGlobalBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId is required' });
  });

  it('returns 400 when title is missing', async () => {
    const { title: _t, ...body } = validGlobalBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title is required' });
  });

  it('returns 400 when content is missing', async () => {
    const { content: _c, ...body } = validGlobalBody;
    const res = await handler(baseReq(body), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ ...validGlobalBody, tags: ['a', 1] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 403 when scope=org and caller is not a member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    // category check won't be reached
    const res = await handler(baseReq(validOrgBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 400 when category not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // category not found
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Category not found' });
  });

  it('returns 403 when global scope and category is restricted (non-admin)', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // restricted category
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when org scope, restricted category, and caller is not org admin', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // restricted category
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validOrgBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('allows org admin to post in restricted org category', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // restricted category
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const newPost = { id: 'post-new', ...validOrgBody };
    mockQueryOne.mockResolvedValueOnce(newPost);
    const res = await handler(baseReq(validOrgBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: newPost });
  });

  it('happy path: creates global post for any authenticated member', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // category check
    const newPost = { id: 'post-new', ...validGlobalBody, user_id: 'p1' };
    mockQueryOne.mockResolvedValueOnce(newPost); // INSERT RETURNING
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ post: newPost });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('happy path: creates org post for active member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // category check
    const newPost = { id: 'post-new', ...validOrgBody, user_id: 'p1' };
    mockQueryOne.mockResolvedValueOnce(newPost); // INSERT RETURNING
    const res = await handler(baseReq(validOrgBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: newPost });

    // Verify INSERT SQL uses profile.id not client-supplied user_id
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO community_posts');
    expect(params).toContain('p1'); // profile.id server-set
    expect(params).not.toContain('user_id'); // the field value, not the column name
  });

  it('platform admin bypasses membership check for org scope', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // category check
    const newPost = { id: 'post-new', ...validOrgBody };
    mockQueryOne.mockResolvedValueOnce(newPost);
    const res = await handler(baseReq(validOrgBody), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('platform admin can post in restricted global category', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // restricted
    const newPost = { id: 'post-new', ...validGlobalBody };
    mockQueryOne.mockResolvedValueOnce(newPost);
    const res = await handler(baseReq(validGlobalBody), {} as any);
    expect(res.status).toBe(200);
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validGlobalBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
