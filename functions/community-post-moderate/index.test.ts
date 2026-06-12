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

const orgPost = { scope: 'org', org_id: 'org-1' };
const globalPost = { scope: 'global', org_id: null };

describe('community-post-moderate', () => {
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
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when postId is missing', async () => {
    const res = await handler(baseReq({ isHidden: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when postId is not a string', async () => {
    const res = await handler(baseReq({ postId: 123, isHidden: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'postId is required' });
  });

  it('returns 400 when neither isHidden nor isLocked is provided', async () => {
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Provide isHidden or isLocked to update' });
  });

  it('returns 400 when isHidden is not a boolean', async () => {
    const res = await handler(baseReq({ postId: 'post-1', isHidden: 'true' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'isHidden must be a boolean' });
  });

  it('returns 400 when isLocked is not a boolean', async () => {
    const res = await handler(baseReq({ postId: 'post-1', isLocked: 1 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'isLocked must be a boolean' });
  });

  it('returns 404 when post not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-999', isHidden: true }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Post not found' });
  });

  // Non-admin on org post → 403
  it('returns 403 when non-admin tries to moderate an org post', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  // Org admin of different org → 403 (isOrgAdmin returns false)
  it('returns 403 when org admin of a different org tries to moderate', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost); // org_id = 'org-1'
    mockIsOrgAdmin.mockResolvedValueOnce(false); // not admin of org-1
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
  });

  // Global post — non-platform-admin → 403, isOrgAdmin NOT called
  it('returns 403 for global post when non-platform-admin (isOrgAdmin not called)', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(403);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  // Happy path: org admin hides post
  it('happy path: org admin can hide post', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...orgPost, id: 'post-1', is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: updated });

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql, params] = updateCall;
    expect(sql).toContain('UPDATE community_posts');
    expect(sql).toContain('is_hidden =');
    expect(sql).not.toContain('is_locked =');
    expect(params).toContain(true);
    expect(params).toContain('post-1');
  });

  // Happy path: both fields updated
  it('happy path: both isHidden and isLocked updated together', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const updated = { ...orgPost, id: 'post-1', is_hidden: true, is_locked: true };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true, isLocked: true }), {} as any);
    expect(res.status).toBe(200);

    const updateCall = mockQueryOne.mock.calls[1] as [string, unknown[]];
    const [sql] = updateCall;
    expect(sql).toContain('is_hidden =');
    expect(sql).toContain('is_locked =');
  });

  // Platform admin bypasses isOrgAdmin
  it('platform admin can moderate any post without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(globalPost);
    const updated = { ...globalPost, id: 'post-1', is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1', isHidden: true }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
