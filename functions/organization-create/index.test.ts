import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockHeadBlob, mockDeleteBlob,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockHeadBlob: vi.fn(),
    mockDeleteBlob: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
// `query` is the reference query the REAL blob-ownership bind gate issues — this
// suite exercises that gate rather than stubbing it, so "already claimed by
// another row" is expressed as the rows that query returns.
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));
// Only the two storage round trips are faked, so the tests below can assert that a
// refused path never reaches either. `classifyBlobPath` stays REAL — it is the
// pure string check the gate is built on.
vi.mock('../shared/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/blob')>()),
  headBlob: mockHeadBlob,
  deleteBlob: mockDeleteBlob,
}));

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
    // Default: the bind gate's reference query finds nobody, so a well-shaped
    // fresh logo path binds.
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

  it('returns 400 (not 403) for invalid body when caller is not platform admin', async () => {
    // Pins the deliberate validation-before-authz ordering (why this endpoint
    // uses endpoint() + an inline admin check instead of adminEndpoint).
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
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

  it('returns 400 when name is whitespace only (trimmed length is 0) — I-1', async () => {
    const res = await handler(baseReq({ name: '   ', slug: 'acme-corp' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'name must be a string between 2 and 100 characters' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('persists the name trimmed of surrounding whitespace — I-1', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    await handler(baseReq({ name: '  Acme Corp  ', slug: 'acme-corp' }), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe('Acme Corp');
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

  // ── The bind gate (#280) ────────────────────────────────────────────────────
  // Before this, organization-create was the seventh writer into a column in the
  // reconciliation union and the only one outside the ownership gates: it stored
  // whatever string it was handed.

  it('refuses a foreign-shaped logo_url BEFORE any storage or write call', async () => {
    // A lesson video path posted to logo_url. `course-player-data` hands every
    // lesson path to any active org member, so this is not a guess.
    const res = await handler(baseReq({ ...validBody, logo_url: 'someone-elses-lesson.mp4' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockHeadBlob).not.toHaveBeenCalled();
    expect(mockDeleteBlob).not.toHaveBeenCalled();
    // Out-of-family is a pure string verdict — it does not even cost a round trip.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('refuses an avatar path posted to logo_url', async () => {
    const res = await handler(baseReq({ ...validBody, logo_url: 'avatars/victim.png' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('refuses a well-shaped org-logo path another org already references', async () => {
    // Shape alone cannot catch this: every org logo is `org-logos/<uuid>.<ext>`,
    // and `/organizations` hands logo_url to plain learners.
    mockQuery.mockResolvedValueOnce([{ path: 'org-logos/other-org.png' }]);
    const res = await handler(baseReq({ ...validBody, logo_url: 'org-logos/other-org.png' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Invalid upload path' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('accepts a freshly minted org-logo path no row references', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'org-1' });
    const res = await handler(baseReq({ ...validBody, logo_url: 'org-logos/fresh.png' }), {} as any);
    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe('org-logos/fresh.png');
  });

  it('gates AFTER the platform-admin check — a denied caller never reaches the DB', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    const res = await handler(baseReq({ ...validBody, logo_url: 'org-logos/fresh.png' }), {} as any);
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
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
