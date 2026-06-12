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
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const sampleChampion = {
  id: 'ac1', user_id: 'p2', org_id: 'org-1', assigned_by: 'p1', assigned_at: '2026-01-01T00:00:00Z',
};

describe('ai-champion-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
    mockQueryOne.mockResolvedValue(sampleChampion);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ userId: 'p2' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when userId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 403 when caller is neither platform admin nor org admin', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('happy path: org admin assigns a champion; assigned_by is the CALLER profile id', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ champion: sampleChampion });
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ai_champions');
    expect(sql).toContain('RETURNING');
    expect(params).toEqual(['p2', 'org-1', 'p1']); // assigned_by = profile.id, server-derived
  });

  it('platform admin can assign without isOrgAdmin being consulted', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 409 on duplicate champion (unique violation)', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'User is already an AI Champion in this organization' });
  });

  it('returns 404 on FK violation (org or user not found)', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization or user not found' });
  });

  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
