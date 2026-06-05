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

const globalPost = {
  id: 'post-1',
  scope: 'global',
  org_id: null,
  user_id: 'p2',
  is_hidden: false,
  category_id: 'cat-1',
  title: 'Hello',
  content: 'World',
};

const orgPost = {
  id: 'post-2',
  scope: 'org',
  org_id: 'org-1',
  user_id: 'p2',
  is_hidden: false,
  category_id: 'cat-1',
  title: 'Org Post',
  content: 'Content',
};

describe('community-post', () => {
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

  it('returns 200 { post: null } when post not found (maybeSingle parity)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ postId: 'post-999' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: null });
  });

  it('returns 200 with global post for any authenticated user', async () => {
    mockQueryOne.mockResolvedValueOnce(globalPost);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: globalPost });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 200 { post: null } for org post when caller is not a member', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsActiveMember.mockResolvedValueOnce(false);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: null });
  });

  it('returns 200 with org post when caller is a member', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsActiveMember.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: orgPost });
  });

  it('returns 200 with org post when caller is org admin (even if not member)', async () => {
    mockQueryOne.mockResolvedValueOnce(orgPost);
    mockIsActiveMember.mockResolvedValueOnce(false);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: orgPost });
  });

  it('returns 200 { post: null } for hidden post when caller is not org admin', async () => {
    const hiddenPost = { ...orgPost, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenPost);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: null });
  });

  it('returns 200 with hidden post for org admin', async () => {
    const hiddenPost = { ...orgPost, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenPost);
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    // isOrgAdmin called again for hidden check
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: hiddenPost });
  });

  it('returns 200 { post: null } for hidden global post when caller is not platform admin', async () => {
    const hiddenGlobal = { ...globalPost, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenGlobal);
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: null });
  });

  it('platform admin bypasses access checks and sees hidden posts', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const hiddenPost = { ...orgPost, is_hidden: true };
    mockQueryOne.mockResolvedValueOnce(hiddenPost);
    const res = await handler(baseReq({ postId: 'post-2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ post: hiddenPost });
    expect(mockIsActiveMember).not.toHaveBeenCalled();
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ postId: 'post-1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
