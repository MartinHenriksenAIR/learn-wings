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

const othersResource = { id: 'r1', org_id: 'org-1', user_id: 'p2' };
const myResource = { ...othersResource, user_id: 'p1' };

describe('resource-pin', () => {
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
    const res = await handler(baseReq({ resourceId: 'r1', pinned: true }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when resourceId is missing', async () => {
    const res = await handler(baseReq({ pinned: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'resourceId is required' });
  });

  it('returns 400 when pinned is missing', async () => {
    const res = await handler(baseReq({ resourceId: 'r1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'pinned must be a boolean' });
  });

  it('returns 400 when pinned is not boolean', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', pinned: 'yes' }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when resource not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ resourceId: 'r-x', pinned: true }), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 403 when a non-author plain member tries to pin', async () => {
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ resourceId: 'r1', pinned: true }), {} as any);
    expect(res.status).toBe(403);
  });

  it('happy path: author pins their own resource', async () => {
    mockQueryOne.mockResolvedValueOnce(myResource);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', is_pinned: true, profile: null });
    const res = await handler(baseReq({ resourceId: 'r1', pinned: true }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE community_resources SET is_pinned');
    expect(params).toEqual([true, 'r1']);
  });

  it('happy path: org admin pins someone else\'s resource', async () => {
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', is_pinned: true, profile: null });
    const res = await handler(baseReq({ resourceId: 'r1', pinned: true }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('platform admin unpins any resource without isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', is_pinned: false, profile: null });
    const res = await handler(baseReq({ resourceId: 'r1', pinned: false }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ resourceId: 'r1', pinned: true }), {} as any);
    expect(res.status).toBe(500);
  });
});
