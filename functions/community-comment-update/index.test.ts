import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
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

// comment.user_id is 'p2' (not the caller 'p1') by default
const otherUserComment = { user_id: 'p2', is_hidden: false, scope: 'org' as const, org_id: 'org-1' };
const myComment = { ...otherUserComment, user_id: 'p1' };
const myHiddenComment = { ...myComment, is_hidden: true };
const globalComment = { user_id: 'p2', is_hidden: false, scope: 'global' as const, org_id: null };
const myGlobalComment = { ...globalComment, user_id: 'p1' };

const updatedComment = { id: 'c1', user_id: 'p1', content: 'Updated content', is_hidden: false };

describe('community-comment-update', () => {
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
    const res = await handler(baseReq({ commentId: 'c1', content: 'hi' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c1', content: 'hi' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when commentId is missing', async () => {
    const res = await handler(baseReq({ content: 'hi' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 400 when commentId is not a string', async () => {
    const res = await handler(baseReq({ commentId: 123, content: 'hi' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 400 when content is missing', async () => {
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is empty string', async () => {
    const res = await handler(baseReq({ commentId: 'c1', content: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 400 when content is not a string', async () => {
    const res = await handler(baseReq({ commentId: 'c1', content: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'content is required' });
  });

  it('returns 404 when comment is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c-999', content: 'hi' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Comment not found' });
  });

  it('returns 403 when non-author non-admin tries to update', async () => {
    mockQueryOne.mockResolvedValueOnce(otherUserComment);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ commentId: 'c1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // RLS asymmetry: author of HIDDEN comment cannot UPDATE (but can DELETE — tested in delete suite)
  it('returns 403 when author tries to update their own hidden comment', async () => {
    mockQueryOne.mockResolvedValueOnce(myHiddenComment);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ commentId: 'c1', content: 'hi' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // Org admin CAN edit hidden comments
  it('org admin can update a hidden comment in their org', async () => {
    const hiddenOtherComment = { ...otherUserComment, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenOtherComment);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(updatedComment);
    const res = await handler(baseReq({ commentId: 'c1', content: 'Updated content' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comment: updatedComment });
  });

  it('happy path: author updates their own visible comment', async () => {
    mockQueryOne.mockResolvedValueOnce(myComment);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce(updatedComment);
    const res = await handler(baseReq({ commentId: 'c1', content: 'Updated content' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comment: updatedComment });
  });

  it('happy path: author updates their own global comment', async () => {
    mockQueryOne.mockResolvedValueOnce(myGlobalComment);
    mockQueryOne.mockResolvedValueOnce(updatedComment);
    const res = await handler(baseReq({ commentId: 'c1', content: 'Updated content' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('platform admin can update any comment without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(otherUserComment);
    mockQueryOne.mockResolvedValueOnce(updatedComment);
    const res = await handler(baseReq({ commentId: 'c1', content: 'Updated content' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('asserts SQL fragments in update query', async () => {
    mockQueryOne.mockResolvedValueOnce(myComment);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce(updatedComment);
    await handler(baseReq({ commentId: 'c1', content: 'Updated content' }), {} as any);
    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('UPDATE community_comments');
    expect(sql).toContain('content');
    expect(sql).toContain('RETURNING');
    expect(params).toContain('Updated content');
    expect(params).toContain('c1');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ commentId: 'c1', content: 'hi' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
