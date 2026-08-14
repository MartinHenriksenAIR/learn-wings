import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockDeleteBlob, mockCleanupBlobs,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockDeleteBlob = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob,
    mockCleanupBlobs: vi.fn(async (paths: string[], _logTag: string, _id: string) => {
      const results = await Promise.all(paths.map((p) => mockDeleteBlob(p)));
      const blobsDeleted = results.filter(Boolean).length;
      return { blobsDeleted, blobsFailed: results.length - blobsDeleted };
    }),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));
vi.mock('../shared/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/blob')>()),
  deleteBlob: mockDeleteBlob,
  cleanupBlobs: mockCleanupBlobs,
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('organization-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockDeleteBlob.mockResolvedValue(true);
    mockQuery.mockResolvedValue([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 when caller is not a platform admin, with no DB call', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 (not 403) for invalid body when caller is not platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is not a string', async () => {
    const res = await handler(baseReq({ orgId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 404 when organization not found — deleteBlob never called', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-x' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization not found' });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('happy path: platform admin deletes an organization', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: null });
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true, blobsDeleted: 0, blobsFailed: 0 });
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM organizations');
    expect(sql).toContain('RETURNING id');
    expect(sql).toContain('logo_url');
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(params).toEqual(['org-1']);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deletes the org logo blob — #285', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'org-logos/logo.png' });
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true, blobsDeleted: 1, blobsFailed: 0 });
    expect(mockCleanupBlobs).toHaveBeenCalledWith(['org-logos/logo.png'], 'organization-delete', 'org-1');
    expect(mockDeleteBlob).toHaveBeenCalledWith('org-logos/logo.png');
  });

  it('a failed storage delete is counted, not fatal: blobsFailed:1, still 200', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'org-logos/logo.png' });
    mockDeleteBlob.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true, blobsDeleted: 0, blobsFailed: 1 });
  });

  it('leaves a logo another row still references, and still deletes an unreferenced one — #285', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'org-logos/shared.png' });
    mockQuery.mockResolvedValueOnce([{ path: 'org-logos/shared.png' }]);
    const shared = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(shared.status).toBe(200);
    expect(JSON.parse(shared.body as string)).toEqual({ ok: true, blobsDeleted: 0, blobsFailed: 0 });
    expect(mockDeleteBlob).not.toHaveBeenCalled();

    mockQueryOne.mockResolvedValueOnce({ id: 'org-2', logo_url: 'org-logos/sibling.png' });
    mockQuery.mockResolvedValueOnce([]);
    const sibling = await handler(baseReq({ orgId: 'org-2' }), {} as any);
    expect(sibling.status).toBe(200);
    expect(JSON.parse(sibling.body as string)).toEqual({ ok: true, blobsDeleted: 1, blobsFailed: 0 });
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('org-logos/sibling.png');
  });

  it('release-check DB failure: nothing deleted, request still succeeds', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'org-logos/logo.png' });
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true, blobsDeleted: 0, blobsFailed: 0 });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('leaves an absolute external logo_url alone — it names no blob we own', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'https://cdn.example.com/logo.png' });
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true, blobsDeleted: 0, blobsFailed: 0 });
    expect(mockDeleteBlob).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
