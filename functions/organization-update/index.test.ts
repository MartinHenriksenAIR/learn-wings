import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin, mockDeleteBlob,
  mockEnforceUploadLimits, mockAssertBindablePaths, mockIsBlobReleasable,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
    mockDeleteBlob: vi.fn(),
    mockEnforceUploadLimits: vi.fn(),
    mockAssertBindablePaths: vi.fn(),
    mockIsBlobReleasable: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));
vi.mock('../shared/blob', () => ({ deleteBlob: mockDeleteBlob }));
vi.mock('../shared/upload-limits', () => ({ enforceUploadLimits: mockEnforceUploadLimits }));
vi.mock('../shared/blob-ownership', () => ({
  assertBindablePaths: mockAssertBindablePaths,
  isBlobReleasable: mockIsBlobReleasable,
}));

import handler from './index';

const logoCandidate = (path: string | null) => [{ path, kind: 'image', family: 'org-logo' }];

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const existingOrg = { id: 'org-1' };

const mockLogoDb = (previousLogoUrl: string | null, updated: unknown = { id: 'org-1' }) => {
  mockQueryOne.mockResolvedValueOnce({ logo_url: previousLogoUrl }).mockResolvedValueOnce(updated);
};

describe('organization-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
    mockDeleteBlob.mockResolvedValue(true);
    mockEnforceUploadLimits.mockResolvedValue(null); // no upload-limit objection
    mockAssertBindablePaths.mockResolvedValue(null); // the path is the caller's to bind
    mockIsBlobReleasable.mockResolvedValue(true);    // nothing else references the old blob
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

  it('returns 400 (not 403) for invalid body when caller is not platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
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
    mockQueryOne.mockResolvedValueOnce(null);
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
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ organization: updated });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('name = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(sql).toContain('RETURNING id, name, slug, logo_url, seat_limit, entra_tid, entra_tid_label, allow_self_registration, created_at');
    expect(params).toEqual(['New Name', 'org-1']);
  });

  it('multi-field update: builds SET clauses + params in submission order', async () => {
    mockLogoDb(null); // logo_url is in the update → previous-logo SELECT, then UPDATE RETURNING
    const res = await handler(
      baseReq({
        orgId: 'org-1',
        updates: { name: 'New Name', slug: 'new-slug', logo_url: null, seat_limit: 50 },
      }),
      {} as any,
    );
    expect(res.status).toBe(200);

    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
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
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  const TID = '72f988bf-86f1-41af-91ab-2d7cd011db47';

  it('returns 400 when entra_tid is not a GUID', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid: 'not-a-guid' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'entra_tid must be a tenant GUID or null' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('refuses the shared consumer/MSA tenant (400)', async () => {
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { entra_tid: '9188040d-6c67-4c5b-b112-36a304b66dad' } }),
      {} as any,
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'That is the shared personal-Microsoft-account tenant and cannot be linked to an organization',
      code: 'CONSUMER_TENANT',
    });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when entra_tid_label is the wrong type', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid_label: 42 } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'entra_tid_label must be a string (max 253 chars) or null' });
  });

  it('platform admin can set the binding; the tid is normalized to lowercase', async () => {
    const updated = { id: 'org-1', name: 'Acme', slug: 'acme', logo_url: null, seat_limit: null, entra_tid: TID, entra_tid_label: 'acme.com', created_at: 'x' };
    mockQueryOne.mockResolvedValueOnce(updated);
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { entra_tid: TID.toUpperCase(), entra_tid_label: 'acme.com' } }),
      {} as any,
    );
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('entra_tid = $1');
    expect(sql).toContain('entra_tid_label = $2');
    expect(params).toEqual([TID, 'acme.com', 'org-1']); // lowercased
  });

  it('returns 400 when entra_tid_label exceeds the length bound', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid_label: 'a'.repeat(254) } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'entra_tid_label must be a string (max 253 chars) or null' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('clearing entra_tid also clears entra_tid_label (no orphan label)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', entra_tid: null, entra_tid_label: null });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid: null } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('entra_tid = $1');
    expect(sql).toContain('entra_tid_label = $2'); // forced in by the endpoint
    expect(params).toEqual([null, null, 'org-1']);
  });

  it('returns a distinct 409 when the tenant is already linked to another org', async () => {
    mockQueryOne.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'organizations_entra_tid_key' }),
    );
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid: TID } }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'This Microsoft tenant is already linked to another organization',
      code: 'DUPLICATE_TENANT',
    });
  });

  it('an org admin cannot set the tenant binding (403, no DB touch)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(true);
    const res = await handler(baseReq({ orgId: 'org-1', updates: { entra_tid: TID } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('org admin of the target org can update logo_url only', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockLogoDb(null, { id: 'org-1', logo_url: 'https://x/logo.png' });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: 'https://x/logo.png' } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('logo_url = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(params).toEqual(['https://x/logo.png', 'org-1']);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('org admin cannot update platform-only fields', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { seat_limit: 5 } }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('org admin cannot smuggle a platform-only field alongside logo_url', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { logo_url: 'https://x/logo.png', seat_limit: 5 } }),
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
    mockLogoDb(null, { id: 'org-1', logo_url: null });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { logo_url: null } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('logo_url = $1');
    expect(params).toEqual([null, 'org-1']);
  });


  it('returns 400 when allow_self_registration is not a boolean (before authz/DB)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', updates: { allow_self_registration: 'yes' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'allow_self_registration must be a boolean' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('platform admin can toggle allow_self_registration off', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', allow_self_registration: false });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { allow_self_registration: false } }), {} as any);
    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('allow_self_registration = $1');
    expect(params).toEqual([false, 'org-1']);
  });

  it('org admin of the target org can toggle allow_self_registration (org-owned setting)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', allow_self_registration: true });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { allow_self_registration: true } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('allow_self_registration = $1');
    expect(params).toEqual([true, 'org-1']);
  });

  it('org admin can update logo_url and allow_self_registration together', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockLogoDb(null, { id: 'org-1', logo_url: 'org-logos/new.png', allow_self_registration: false });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { logo_url: 'org-logos/new.png', allow_self_registration: false } }),
      {} as any,
    );
    expect(res.status).toBe(200);
    const [sql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('logo_url = $1');
    expect(sql).toContain('allow_self_registration = $2');
  });

  it('org admin cannot smuggle a platform-only field alongside allow_self_registration', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { allow_self_registration: true, seat_limit: 5 } }),
      {} as any,
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });


  it('org admin of the target org can rename their own org (name)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1', name: 'Renamed Co' });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'Renamed Co' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockIsOrgAdmin).toHaveBeenCalledWith('p1', 'org-1');
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE organizations SET');
    expect(sql).toContain('name = $1');
    expect(params).toEqual(['Renamed Co', 'org-1']);
  });

  it('org admin can update name and logo_url together', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockLogoDb(null, { id: 'org-1', name: 'Renamed Co', logo_url: 'org-logos/new.png' });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { name: 'Renamed Co', logo_url: 'org-logos/new.png' } }),
      {} as any,
    );
    expect(res.status).toBe(200);
    const [sql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('name = $1');
    expect(sql).toContain('logo_url = $2');
  });

  it('org admin cannot smuggle slug alongside name (slug stays platform-only)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { name: 'Renamed Co', slug: 'renamed-co' } }),
      {} as any,
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  const logoUpdate = (logo_url: string | null) => ({ orgId: 'org-1', updates: { logo_url } });

  it('logo replaced: deletes the OLD blob exactly once', async () => {
    mockLogoDb('org-logos/old.png');
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('org-logos/old.png');
  });

  it('logo cleared to null: deletes the OLD blob', async () => {
    mockLogoDb('org-logos/old.png');
    const res = await handler(baseReq(logoUpdate(null)), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('org-logos/old.png');
  });

  it('logo unchanged: deletes nothing', async () => {
    mockLogoDb('org-logos/keep.png');
    const res = await handler(baseReq(logoUpdate('org-logos/keep.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('old logo was null: deletes nothing', async () => {
    mockLogoDb(null);
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('logo_url absent from updates is NOT a clear: no SELECT, no delete', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    const res = await handler(baseReq({ orgId: 'org-1', updates: { name: 'New Name' } }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('reads the previous logo with a SELECT before the UPDATE, after the authz gate', async () => {
    mockLogoDb('org-logos/old.png');
    await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);

    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [selectSql, selectParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/SELECT logo_url FROM organizations/i);
    expect(selectParams).toEqual(['org-1']);
  });

  it('non-admin member gets 403 for logo_url without ever reaching the previous-logo SELECT', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(403);
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('404 (org vanished): deletes nothing', async () => {
    mockLogoDb('org-logos/old.png', null);
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(404);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('409 duplicate slug alongside a logo change: deletes nothing', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ logo_url: 'org-logos/old.png' })
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(
      baseReq({ orgId: 'org-1', updates: { logo_url: 'org-logos/new.png', slug: 'taken-slug' } }),
      {} as any,
    );
    expect(res.status).toBe(409);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('413 when the new logo is over cap: no UPDATE is issued', async () => {
    mockQueryOne.mockResolvedValueOnce({ logo_url: null }); // only the previous-logo SELECT
    mockEnforceUploadLimits.mockResolvedValueOnce('Image exceeds the maximum upload size of 10 MB');

    const res = await handler(baseReq(logoUpdate('org-logos/huge.png')), {} as any);

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'Image exceeds the maximum upload size of 10 MB',
    });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE organizations');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('hands the logo to the gate with the previous path, after the SELECT and before the UPDATE', async () => {
    const order: string[] = [];
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('gate'); return null; });
    mockQueryOne
      .mockImplementationOnce(async () => { order.push('select'); return { logo_url: 'org-logos/old.png' }; })
      .mockImplementationOnce(async () => { order.push('update'); return { id: 'org-1' }; });

    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);

    expect(res.status).toBe(200);
    expect(mockEnforceUploadLimits).toHaveBeenCalledWith(
      logoCandidate('org-logos/new.png'),
      ['org-logos/old.png'], // unchanged path ⇒ not new ⇒ never probed
    );
    expect(order).toEqual(['select', 'gate', 'update']);
  });

  it('a non-admin member never reaches the gate (authz first, storage never touched)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(403);
    expect(mockEnforceUploadLimits).not.toHaveBeenCalled();
    expect(mockAssertBindablePaths).not.toHaveBeenCalled();
  });


  it('400 when the ownership gate refuses the path: no probe, no UPDATE, no delete', async () => {
    mockQueryOne.mockResolvedValueOnce({ logo_url: null }); // only the previous-logo SELECT
    mockAssertBindablePaths.mockResolvedValueOnce('Invalid upload path');

    const res = await handler(baseReq(logoUpdate('avatars/victim.png')), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockEnforceUploadLimits).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQueryOne.mock.calls[0][0]).not.toContain('UPDATE organizations');
  });

  it('runs the ownership gate BEFORE the size gate, on the same candidate list', async () => {
    const order: string[] = [];
    mockAssertBindablePaths.mockImplementationOnce(async () => { order.push('ownership'); return null; });
    mockEnforceUploadLimits.mockImplementationOnce(async () => { order.push('limits'); return null; });
    mockLogoDb('org-logos/old.png');

    await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);

    expect(order).toEqual(['ownership', 'limits']);
    expect(mockAssertBindablePaths).toHaveBeenCalledWith(
      logoCandidate('org-logos/new.png'),
      ['org-logos/old.png'],
    );
    expect(mockAssertBindablePaths.mock.calls[0][0]).toEqual(mockEnforceUploadLimits.mock.calls[0][0]);
  });

  it('step 2 of the two-step attack: a still-referenced old logo is NOT deleted', async () => {
    mockIsBlobReleasable.mockResolvedValueOnce(false);
    mockLogoDb('org-logos/shared.png');

    const res = await handler(baseReq(logoUpdate(null)), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsBlobReleasable).toHaveBeenCalledWith('org-logos/shared.png', 'org-logo');
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('asks whether the old blob is releasable only AFTER the row write', async () => {
    const order: string[] = [];
    mockQueryOne
      .mockImplementationOnce(async () => ({ logo_url: 'org-logos/old.png' }))
      .mockImplementationOnce(async () => { order.push('update'); return { id: 'org-1' }; });
    mockIsBlobReleasable.mockImplementationOnce(async () => { order.push('releasable'); return true; });
    mockDeleteBlob.mockImplementationOnce(async () => { order.push('delete'); return true; });

    await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);

    expect(order).toEqual(['update', 'releasable', 'delete']);
  });

  it('deleteBlob returns false: request still succeeds with its normal body', async () => {
    const updated = { id: 'org-1', logo_url: 'org-logos/new.png' };
    mockLogoDb('org-logos/old.png', updated);
    mockDeleteBlob.mockResolvedValue(false);
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ organization: updated });
  });

  it('storage fetch rejects (helper swallows it → false): request still succeeds', async () => {
    const updated = { id: 'org-1', logo_url: 'org-logos/new.png' };
    mockLogoDb('org-logos/old.png', updated);
    mockDeleteBlob.mockResolvedValue(false); // deleteBlob never throws — a rejected fetch surfaces as false
    const res = await handler(baseReq(logoUpdate('org-logos/new.png')), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ organization: updated });
  });
});
