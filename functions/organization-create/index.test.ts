import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = {
  name: 'Acme Corp',
  slug: 'acme-corp',
};

describe('organization-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 when caller is not a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when name is missing', async () => {
    const res = await handler(baseReq({ slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
  });

  it('returns 400 when name is wrong type', async () => {
    const res = await handler(baseReq({ name: 42, slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
  });

  it('returns 400 when name is too short', async () => {
    const res = await handler(baseReq({ name: 'a', slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
  });

  it('returns 400 when name is too long', async () => {
    const res = await handler(baseReq({ name: 'a'.repeat(101), slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
  });

  it('returns 400 when slug is missing', async () => {
    const res = await handler(baseReq({ name: 'Acme Corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'slug must be a string between 2 and 50 characters' });
  });

  it('returns 400 when slug is wrong type', async () => {
    const res = await handler(baseReq({ name: 'Acme Corp', slug: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'slug must be a string between 2 and 50 characters' });
  });

  it('returns 400 when slug is too short', async () => {
    const res = await handler(baseReq({ name: 'Acme Corp', slug: 'a' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'slug must be a string between 2 and 50 characters' });
  });

  it('returns 400 when slug is too long', async () => {
    const res = await handler(baseReq({ name: 'Acme Corp', slug: 'a'.repeat(51) }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'slug must be a string between 2 and 50 characters' });
  });

  it('returns 400 when slug has invalid characters', async () => {
    const res = await handler(baseReq({ name: 'Acme Corp', slug: 'Acme_Corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({
      error: 'slug must contain only lowercase letters, numbers, and hyphens',
    });
  });

  it('returns 400 when logo_url is wrong type', async () => {
    const res = await handler(baseReq({ ...validBody, logo_url: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'logo_url must be a string or null' });
  });

  it('returns 400 when seat_limit is not a positive integer', async () => {
    const res = await handler(baseReq({ ...validBody, seat_limit: 0 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'seat_limit must be a positive integer or null' });
  });

  it('returns 400 when seat_limit is a non-integer number', async () => {
    const res = await handler(baseReq({ ...validBody, seat_limit: 2.5 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'seat_limit must be a positive integer or null' });
  });

  it('accepts null seat_limit', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    const res = await handler(baseReq({ ...validBody, seat_limit: null }), {} as any);
    expect(res.status).toBe(200);
  });

  it('accepts omitted seat_limit (defaults to null)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    await handler(baseReq(validBody), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBeNull();
  });

  it('happy path: creates organization and returns the projected row', async () => {
    const newOrg = {
      id: 'org-new',
      name: 'Acme Corp',
      slug: 'acme-corp',
      logo_url: 'https://example.com/logo.png',
      seat_limit: 25,
      created_at: '2026-06-06T12:00:00.000Z',
    };
    mockQueryOne.mockResolvedValueOnce(newOrg);
    const res = await handler(
      baseReq({ name: 'Acme Corp', slug: 'acme-corp', logo_url: 'https://example.com/logo.png', seat_limit: 25 }),
      {} as any,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ organization: newOrg });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO organizations');
    expect(sql).toContain('RETURNING id, name, slug, logo_url, seat_limit, created_at');
    expect(params).toEqual(['Acme Corp', 'acme-corp', 'https://example.com/logo.png', 25]);
  });

  it('returns 409 on duplicate slug (Postgres 23505)', async () => {
    mockQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value'), { code: '23505' }));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Slug already in use', code: 'DUPLICATE_SLUG' });
  });

  it('returns 500 on generic db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
