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

const orgPostRow = { scope: 'org', org_id: 'org-1' };
const globalPostRow = { scope: 'global', org_id: null };

describe('community-comment-moderate', () => {
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
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when commentId is missing', async () => {
    const res = await handler(baseReq({ isHidden: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 400 when commentId is not a string', async () => {
    const res = await handler(baseReq({ commentId: 123, isHidden: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'commentId is required' });
  });

  it('returns 400 when isHidden is missing', async () => {
    const res = await handler(baseReq({ commentId: 'c1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'isHidden is required and must be a boolean' });
  });

  it('returns 400 when isHidden is not a boolean', async () => {
    const res = await handler(baseReq({ commentId: 'c1', isHidden: 'true' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'isHidden is required and must be a boolean' });
  });

  it('returns 404 when comment not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ commentId: 'c-999', isHidden: true }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Comment not found' });
  });

  // Non-admin on org comment → 403
  it('returns 403 when non-admin tries to moderate an org comment', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPostRow);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // Org admin of different org → 403
  it('returns 403 when org admin of different org tries to moderate', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPostRow); // org_id = 'org-1'
    mockIsOrgAdmin.mockResolvedValueOnce(false); // not admin of org-1
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
  });

  // Comment on global post — non-platform-admin → 403, isOrgAdmin NOT called
  it('returns 403 for comment on global post when non-platform-admin (isOrgAdmin not called)', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPostRow);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // Happy path: org admin hides a comment
  it('happy path: org admin can hide comment on org post', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPostRow);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'c1', post_id: 'post-1', is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ comment: updated });

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('UPDATE community_comments');
    expect(sql).toContain('is_hidden = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(params).toEqual([true, 'c1']);
  });

  // Happy path: unhide (isHidden = false)
  it('happy path: org admin can unhide a comment', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPostRow);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { id: 'c1', is_hidden: false };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: false }), {} as any);
    expect(res.status).toBe(200);
    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(updateCall[1]).toEqual([false, 'c1']);
  });

  // Platform admin bypasses isOrgAdmin — also asserts load query uses JOIN
  it('platform admin can moderate comment on global post without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(globalPostRow);
    const updated = { id: 'c1', is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();

    const loadCall = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(loadCall[0]).toContain('JOIN community_posts p ON p.id = c.post_id');
    expect(loadCall[0]).toContain('WHERE c.id = $1');
    expect(loadCall[1]).toContain('c1');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ commentId: 'c1', isHidden: true }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
