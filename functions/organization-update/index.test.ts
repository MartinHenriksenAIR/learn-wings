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
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const existingOrg = { id: 'org-1' };

describe('organization-update', () => {
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
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 when caller is not a platform admin (and does NOT issue the existence check)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when orgId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 42, updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when updates is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates is an array', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: ['name'] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when updates includes a non-whitelisted key (id)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { id: 'evil' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid update field: id' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when updates includes a non-whitelisted key (created_at)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { created_at: '2026-01-01' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid update field: created_at' });
  });

  it('returns 400 when updates is empty', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No update fields provided' });
  });

  it('returns 400 when name is too short', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'a' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
  });

  it('returns 400 when slug has invalid characters', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { slug: 'Bad_Slug' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'slug must contain only lowercase letters, numbers, and hyphens',
    });
  });

  it('returns 400 when logo_url is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: 42 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'logo_url must be a string or null' });
  });

  it('returns 400 when seat_limit is zero', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { seat_limit: 0 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'seat_limit must be a positive integer or null' });
  });

  it('returns 404 when organization does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // UPDATE RETURNING null = no row matched
    const res = await handler(baseReq({ orgId: 'org-x', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Organization not found' });
  });

  it('happy path: returns the updated organization and builds expected UPDATE', async () => {
    const updated = {
      id: 'org-1',
      name: 'New Name',
      slug: 'acme-corp',
      logo_url: 'https://example.com/logo.png',
      seat_limit: 25,
      created_at: '2026-06-06T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(updated); // UPDATE RETURNING
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ organization: updated });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('name = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(sql).toContain('RETURNING id, name, slug, logo_url, seat_limit, created_at');
    expect(params).toEqual(['New Name', 'org-1']);
  });

  it('multi-field update: builds SET clauses + params in submission order', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' }); // UPDATE RETURNING
    const res = await handler(
      baseReq({
        orgId: 'org-1',
        updates: { name: 'New Name', slug: 'new-slug', logo_url: null, seat_limit: 50 },
      }),
      {} as any,
    );
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('name = $1');
    expect(sql).toContain('slug = $2');
    expect(sql).toContain('logo_url = $3');
    expect(sql).toContain('seat_limit = $4');
    expect(sql).toContain('WHERE id = $5');
    expect(params).toEqual(['New Name', 'new-slug', null, 50, 'org-1']);
  });

  it('returns 409 on duplicate slug (Postgres 23505)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq({ orgId: 'org-1', updates: { slug: 'taken-slug' } }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });

  // --- Org-admin logo_url parity (RLS 20260128223657) ---

  it('org admin of the target org can update logo_url only', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: 'https://x/logo.png' });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: 'https://x/logo.png' } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('logo_url = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(params).toEqual(['https://x/logo.png', 'org-1']);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('org admin cannot update other fields', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    // isOrgAdmin is NOT called — onlyLogoUrl is false (name is not logo_url), so && short-circuits
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('org admin cannot smuggle other fields alongside logo_url', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { logo_url: 'https://x/logo.png', name: 'New Name' } }),
      {} as any,
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('non-admin member gets 403 even for logo_url', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: 'https://x/logo.png' } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('org admin can clear the logo (logo_url: null)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', logo_url: null });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: null } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('logo_url = $1');
    expect(params).toEqual([null, 'org-1']);
  });
});
