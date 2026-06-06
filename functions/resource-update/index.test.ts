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

describe('resource-update', () => {
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
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when resourceId is missing', async () => {
    const res = await handler(baseReq({ updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'resourceId is required' });
  });

  it('returns 400 when updates is missing', async () => {
    const res = await handler(baseReq({ resourceId: 'r1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates is an array', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: ['title'] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates has no whitelisted fields', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: { user_id: 'evil', org_id: 'other' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid update fields provided' });
  });

  it('returns 400 when updates is empty', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No valid update fields provided' });
  });

  it('returns 400 when title is wrong type', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 42 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'title must be a string' });
  });

  it('returns 400 when is_pinned is not boolean', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: { is_pinned: 'yes' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'is_pinned must be a boolean' });
  });

  it('returns 400 when tags is not an array of strings', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: { tags: ['a', 1] } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'tags must be an array of strings' });
  });

  it('returns 400 when resource_type is invalid', async () => {
    const res = await handler(baseReq({ resourceId: 'r1', updates: { resource_type: 'video' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'resource_type must be one of: link, document, template, guide',
    });
  });

  it('returns 404 when resource not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // SELECT
    const res = await handler(baseReq({ resourceId: 'r-x', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Resource not found' });
  });

  it('returns 403 when a non-author plain member tries to update', async () => {
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(403);
  });

  it('happy path: author updates their own resource', async () => {
    mockQueryOne.mockResolvedValueOnce(myResource); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', title: 'new', profile: null }); // UPDATE
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'new' } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE community_resources');
    expect(sql).toContain('LEFT JOIN profiles');
    expect(params).toEqual(['new', 'r1']);
  });

  it('happy path: org admin updates someone else\'s resource', async () => {
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', is_pinned: true, profile: null });
    const res = await handler(baseReq({ resourceId: 'r1', updates: { is_pinned: true } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('happy path: platform admin updates any resource without isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(othersResource);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', profile: null });
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('ignores non-whitelisted keys like user_id / org_id / id', async () => {
    mockQueryOne.mockResolvedValueOnce(myResource);
    mockQueryOne.mockResolvedValueOnce({ id: 'r1', profile: null });
    await handler(baseReq({
      resourceId: 'r1',
      updates: { title: 'new', user_id: 'evil', org_id: 'other', id: 'spoof' },
    }), {} as any);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/SET title = \$1/);
    expect(sql).not.toContain('user_id =');
    expect(sql).not.toContain('org_id =');
    expect(params).not.toContain('evil');
    expect(params).not.toContain('other');
    expect(params).not.toContain('spoof');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ resourceId: 'r1', updates: { title: 'x' } }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
