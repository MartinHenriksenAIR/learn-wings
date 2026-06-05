import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const orgPost = {
  user_id: 'p2',
  scope: 'org',
  org_id: 'org-1',
  is_hidden: false,
  category_id: 'cat-1',
};

const myOrgPost = { ...orgPost, user_id: 'p1' };

describe('community-post-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when postId is missing', async () => {
    const res = await handler(baseReq({ updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when updates is missing', async () => {
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates is an array', async () => {
    const res = await handler(baseReq({ postId: 'post-1', updates: ['title'] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates contains invalid field', async () => {
    const res = await handler(baseReq({ postId: 'post-1', updates: { is_pinned: true } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid update field: is_pinned' });
  });

  it('returns 400 when updates has no whitelisted fields', async () => {
    const res = await handler(baseReq({ postId: 'post-1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid update fields provided' });
  });

  it('returns 404 when post not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // post not found
    const res = await handler(baseReq({ postId: 'post-999', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post not found' });
  });

  it('returns 403 when non-author non-admin tries to update', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when author tries to update a hidden post', async () => {
    const hiddenPost = { ...myOrgPost, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenPost);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when author tries to update post in restricted category', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // author's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // current category restricted
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when author tries to move post into restricted category', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // author's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // current category not restricted
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // new category restricted
    const res = await handler(baseReq({ postId: 'post-1', updates: { category_id: 'cat-restricted' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when author moves post to non-existent category', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // author's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // current category ok
    mockQueryOne.mockResolvedValueOnce(null); // new category not found
    const res = await handler(baseReq({ postId: 'post-1', updates: { category_id: 'cat-missing' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Category not found' });
  });

  it('happy path: author updates their own post', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // current category
    const updated = { ...myOrgPost, title: 'Updated' };
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'Updated' } }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: updated });

    const updateCall = mockQueryOne.mock.calls[2] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('UPDATE community_posts');
    expect(sql).toContain('title');
    expect(params).toContain('Updated');
    expect(params).toContain('post-1');
  });

  it('org admin can update any post in their org', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...orgPost, title: 'Admin Updated' };
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'Admin Updated' } }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: updated });
  });

  it('platform admin can update any post without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    const updated = { ...orgPost, title: 'Plat Updated' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'Plat Updated' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
