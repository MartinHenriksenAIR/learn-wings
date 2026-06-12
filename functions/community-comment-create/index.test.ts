import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsActiveMember, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
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

const globalPost = { scope: 'global', org_id: null, is_locked: false };
const orgPost = { scope: 'org', org_id: 'org-1', is_locked: false };
const lockedPost = { ...orgPost, is_locked: true };

const newComment = {
  id: 'c1',
  post_id: 'post-1',
  user_id: 'p1',
  content: 'A comment',
  parent_comment_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  profile: { id: 'p1', full_name: 'Alice' },
};

describe('community-comment-create', () => {
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
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when postId is missing', async () => {
    const res = await handler(baseReq({ content: 'hi' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when postId is not a string', async () => {
    const res = await handler(baseReq({ postId: 42, content: 'hi' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when content is missing', async () => {
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is empty string', async () => {
    const res = await handler(baseReq({ postId: 'post-1', content: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is not a string', async () => {
    const res = await handler(baseReq({ postId: 'post-1', content: 99 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when parentCommentId is present but not a string', async () => {
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi', parentCommentId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'parentCommentId must be a string' });
  });

  it('returns 404 when post is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-999', content: 'hi' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post not found' });
  });

  it('returns 403 when org post is not accessible to caller (not a member)', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // Accessibility checked before locked
  it('returns 403 Forbidden (not 403 locked) for inaccessible locked org post', async () => {
    mockQueryOne.mockResolvedValueOnce(lockedPost);
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns 403 Post is locked for accessible locked post', async () => {
    mockQueryOne.mockResolvedValueOnce(lockedPost);
    mockIsActiveMember.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post is locked' });
  });

  it('returns 403 Post is locked for globally accessible locked post', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...globalPost, is_locked: true });
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post is locked' });
  });

  it('happy path: member creates comment on org post', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // post
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(newComment); // INSERT CTE RETURNING
    const res = await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comment: newComment });
  });

  it('user_id is set from profile (server-set), not from body', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    mockQueryOne.mockResolvedValueOnce(newComment);
    await handler(baseReq({ postId: 'post-1', content: 'A comment', userId: 'attacker' }), {} as any);
    const insertCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = insertCall;
    expect(sql).toContain('INSERT INTO community_comments');
    // profile.id ('p1') must be the user_id param, not 'attacker'
    expect(params).toContain('p1');
    expect(params).not.toContain('attacker');
  });

  it('parentCommentId defaults to null when not provided', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    mockQueryOne.mockResolvedValueOnce(newComment);
    await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    const insertCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const params = insertCall[1];
    // 4th param is parent_comment_id — should be null
    expect(params[3]).toBeNull();
  });

  it('passes parentCommentId string through to query', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    const commentWithParent = { ...newComment, parent_comment_id: 'c0' };
    mockQueryOne.mockResolvedValueOnce(commentWithParent);
    await handler(baseReq({ postId: 'post-1', content: 'Reply', parentCommentId: 'c0' }), {} as any);
    const insertCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(insertCall[1][3]).toBe('c0');
  });

  it('happy path: any authenticated user can comment on global post (no membership check)', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    mockQueryOne.mockResolvedValueOnce(newComment);
    const res = await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('platform admin can comment without membership checks', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockQueryOne.mockResolvedValueOnce(newComment);
    const res = await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('platform admin commenting on a locked post gets 403 Post is locked (no admin bypass for locked check)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(lockedPost);
    const res = await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post is locked' });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('asserts CTE SQL fragment in insert query', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    mockQueryOne.mockResolvedValueOnce(newComment);
    await handler(baseReq({ postId: 'post-1', content: 'A comment' }), {} as any);
    const insertCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(insertCall[0]).toContain('INSERT INTO community_comments');
    expect(insertCall[0]).toContain('RETURNING');
    expect(insertCall[0]).toContain('json_build_object');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1', content: 'hi' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
