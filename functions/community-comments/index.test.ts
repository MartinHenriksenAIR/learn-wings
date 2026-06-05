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

const globalPost = { scope: 'global', org_id: null };
const orgPost = { scope: 'org', org_id: 'org-1' };

const sampleComment = {
  id: 'c1',
  post_id: 'post-1',
  user_id: 'p2',
  content: 'Hello',
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  profile: { id: 'p2', full_name: 'Bob' },
};

const hiddenComment = { ...sampleComment, id: 'c2', is_hidden: true };

describe('community-comments', () => {
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

  // RLS parity: missing post → 200 { comments: [] }
  it('returns 200 empty array when post is not found (RLS parity)', async () => {
    mockQuery.mockResolvedValueOnce([]); // post query returns no rows
    const res = await handler(baseReq({ postId: 'post-999' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    // comments query must NOT be issued
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  // RLS parity: inaccessible org post → 200 { comments: [] }, no comments query
  it('returns 200 empty array for org post when caller is not a member (no comments query)', async () => {
    mockQuery.mockResolvedValueOnce([orgPost]); // post found
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [] });
    // Only the post SELECT should have fired
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with comments for global post (membership check skipped)', async () => {
    mockQuery.mockResolvedValueOnce([globalPost]); // post
    mockQuery.mockResolvedValueOnce([sampleComment]); // comments
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment] });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 200 with comments for org post when caller is a member', async () => {
    mockQuery.mockResolvedValueOnce([orgPost]); // post
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([sampleComment]); // comments
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment] });
  });

  // Hidden filtering: regular member of org post does NOT see hidden comments
  it('filters hidden comments for regular member (AND c.is_hidden = false in SQL)', async () => {
    mockQuery.mockResolvedValueOnce([orgPost]);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQuery.mockResolvedValueOnce([sampleComment]); // only visible comment returned
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    const commentsCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(commentsCall[0]).toContain('is_hidden = false');
  });

  // Org admin of post's org sees hidden comments
  it('org admin of post org sees hidden comments (no hidden filter in SQL)', async () => {
    mockQuery.mockResolvedValueOnce([orgPost]);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([sampleComment, hiddenComment]);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comments: [sampleComment, hiddenComment] });
    const commentsCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(commentsCall[0]).not.toContain('is_hidden = false');
  });

  // Global post + org admin role: isOrgAdmin must NOT be called (global posts: only plat admin moderates)
  it('global post + org admin role: isOrgAdmin NOT called and hidden still filtered', async () => {
    mockQuery.mockResolvedValueOnce([globalPost]); // global post
    // isOrgAdmin should never be called for global posts
    mockQuery.mockResolvedValueOnce([sampleComment]);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    const commentsCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(commentsCall[0]).toContain('is_hidden = false');
  });

  // Platform admin bypasses all checks and sees hidden comments
  it('platform admin bypasses access checks and sees hidden comments', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery.mockResolvedValueOnce([orgPost]);
    mockQuery.mockResolvedValueOnce([sampleComment, hiddenComment]);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    const commentsCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(commentsCall[0]).not.toContain('is_hidden = false');
  });

  it('asserts SQL fragments and params in comments query', async () => {
    mockQuery.mockResolvedValueOnce([globalPost]);
    mockQuery.mockResolvedValueOnce([sampleComment]);
    await handler(baseReq({ postId: 'post-1' }), {} as any);
    const commentsCall = mockQuery.mock.calls[1] as [string, unknown[]];
    const [sql, params] = commentsCall;
    expect(sql).toContain('FROM community_comments c');
    expect(sql).toContain('JOIN profiles pr');
    expect(sql).toContain('ORDER BY c.created_at ASC');
    expect(params).toContain('post-1');
  });

  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
