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

// comment.user_id = 'p2' (different from caller 'p1') by default
const otherUserComment = { user_id: 'p2', is_hidden: false, scope: 'org' as const, org_id: 'org-1' };
const myComment = { ...otherUserComment, user_id: 'p1' };
const myHiddenComment = { ...myComment, is_hidden: true };
const globalOtherComment = { user_id: 'p2', is_hidden: false, scope: 'global' as const, org_id: null };
const myGlobalComment = { ...globalOtherComment, user_id: 'p1' };

describe('community-comment-delete', () => {
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
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when commentId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 400 when commentId is not a string', async () => {
    const res = await handler(baseReq({ commentId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 404 when comment is not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c-999' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Comment not found' });
  });

  it('returns 403 when non-author non-admin tries to delete', async () => {
    mockQueryOne.mockResolvedValueOnce(otherUserComment);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // RLS asymmetry: author CAN delete their own hidden comment (unlike UPDATE which forbids it)
  it('author CAN delete their own hidden comment (RLS asymmetry vs update)', async () => {
    mockQueryOne.mockResolvedValueOnce(myHiddenComment);
    mockQueryOne.mockResolvedValueOnce(null); // DELETE returns null
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
  });

  // Org admin of global post → 403 (only platform admin moderates global)
  it('org admin of global post cannot delete other user comment on global post', async () => {
    mockQueryOne.mockResolvedValueOnce(globalOtherComment); // global scope, org_id null
    // isOrgAdmin called with null org_id — should not matter because scope check prevents it
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    // isOrgAdmin should NOT be called for global posts (no org_id)
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('happy path: author deletes their own visible comment', async () => {
    mockQueryOne.mockResolvedValueOnce(myComment);
    mockQueryOne.mockResolvedValueOnce(null); // DELETE RETURNING is fine returning null
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('happy path: author deletes their own global comment', async () => {
    mockQueryOne.mockResolvedValueOnce(myGlobalComment);
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('org admin can delete a comment in their org', async () => {
    mockQueryOne.mockResolvedValueOnce(otherUserComment);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(null); // DELETE
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
  });

  it('platform admin can delete any comment without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(otherUserComment);
    mockQueryOne.mockResolvedValueOnce(null); // DELETE
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('platform admin can delete global post comment', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(globalOtherComment);
    mockQueryOne.mockResolvedValueOnce(null); // DELETE
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('asserts DELETE SQL fragment and params', async () => {
    mockQueryOne.mockResolvedValueOnce(myComment);
    mockQueryOne.mockResolvedValueOnce(null);
    await handler(baseReq({ commentId: 'c1' }), {} as any);
    const deleteCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = deleteCall;
    expect(sql).toContain('DELETE FROM community_comments');
    expect(params).toContain('c1');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ commentId: 'c1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
