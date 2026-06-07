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

const existingMembership = { org_id: 'org-1' };

describe('org-membership-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when id is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 400 when id is wrong type', async () => {
    const res = await handler(baseReq({ id: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'id is required' });
  });

  it('returns 404 when membership does not exist (and does NOT issue the DELETE)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // SELECT returns no row
    const res = await handler(baseReq({ id: 'm-missing' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Membership not found' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT org_id FROM org_memberships');
  });

  it('returns 403 when caller is neither platform admin nor org admin (and does NOT issue the DELETE)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT returns row
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).toHaveBeenCalledTimes(1); // SELECT only, no DELETE
  });

  it('returns 404 on TOCTOU when DELETE RETURNING is null', async () => {
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce(null); // DELETE RETURNING null
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Membership not found' });
  });

  it('happy path (platform admin): deletes the membership and returns ok', async () => {
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'm1' }); // DELETE RETURNING

    const res = await handler(baseReq({ id: 'm1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled(); // platform-admin bypass

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM org_memberships');
    expect(sql).toContain('WHERE id = $1');
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['m1']);
  });

  it('happy path (org admin): authorizes via isOrgAdmin and deletes', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockResolvedValueOnce({ id: 'm2' }); // DELETE RETURNING

    const res = await handler(baseReq({ id: 'm2' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM org_memberships');
    expect(params).toEqual(['m2']);
  });

  it('returns 500 on generic db error during DELETE', async () => {
    mockQueryOne.mockResolvedValueOnce(existingMembership); // SELECT
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused')); // DELETE
    const res = await handler(baseReq({ id: 'm1' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
