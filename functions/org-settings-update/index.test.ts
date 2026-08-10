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
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('org-settings-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1', features: {} }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ features: {} }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when features is null', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', features: null }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'features must be a plain object' });
  });

  it('returns 400 when features is an array', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', features: ['a', 'b'] }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'features must be a plain object' });
  });

  it('returns 400 when features is a primitive', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', features: 42 }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'features must be a plain object' });
  });

  it('returns 400 when features.leaderboard_enabled is not a boolean (before authz/DB) (#369)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', features: { leaderboard_enabled: 'yes' } }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'features.leaderboard_enabled must be a boolean' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('accepts a boolean features.leaderboard_enabled (#369)', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const row = { org_id: 'org-1', features: { leaderboard_enabled: false } };
    mockQueryOne.mockResolvedValueOnce(row);

    const res = await handler(baseReq({ orgId: 'org-1', features: { leaderboard_enabled: false } }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ settings: row });
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(JSON.stringify({ leaderboard_enabled: false }));
  });

  it('returns 403 for active member who is not org_admin and does not call queryOne', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1', features: { ai: true } }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('upserts settings for org_admin with correct SQL, params, and response shape', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const row = { org_id: 'org-1', features: { ai: true } };
    mockQueryOne.mockResolvedValueOnce(row);

    const res = await handler(baseReq({ orgId: 'org-1', features: { ai: true } }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ settings: row });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT');
    expect(sql).toContain('org_settings');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('updated_by');
    expect(params[0]).toBe('org-1');
    expect(params[1]).toBe(JSON.stringify({ ai: true }));
    expect(params[2]).toBe('p1');
  });

  it('upserts settings for platform admin without calling isOrgAdmin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const row = { org_id: 'org-1', features: {} };
    mockQueryOne.mockResolvedValueOnce(row);

    const res = await handler(baseReq({ orgId: 'org-1', features: {} }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ settings: row });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1', features: { x: 1 } }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
