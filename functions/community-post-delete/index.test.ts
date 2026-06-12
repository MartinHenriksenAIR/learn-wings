import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
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
  category_id: 'cat-1',
};

const myOrgPost = { ...orgPost, user_id: 'p1' };

describe('community-post-delete', () => {
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
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when postId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when postId is not a string', async () => {
    const res = await handler(baseReq({ postId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 404 when post not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-999' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post not found' });
  });

  it('returns 403 when non-author non-admin tries to delete', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 when author tries to delete a post in restricted category', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // author's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: true }); // restricted category
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('happy path: author deletes their own post in non-restricted category', async () => {
    mockQueryOne.mockResolvedValueOnce(myOrgPost); // author's post
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce({ is_restricted: false }); // non-restricted
    mockQuery.mockResolvedValueOnce([]); // DELETE

    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM community_posts');
    expect(params).toEqual(['post-1']);
  });

  it('org admin can delete any post in their org', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
  });

  it('platform admin can delete any post without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(orgPost); // another user's post
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
