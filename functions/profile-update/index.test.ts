import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const profileRow = {
  id: 'p1',
  full_name: 'Alice',
  first_name: 'Alice',
  last_name: null,
  department: null,
  email: 'alice@example.com',
  avatar_url: null,
  is_platform_admin: false,
  preferred_language: 'en',
  created_at: '2024-01-01T00:00:00Z',
};

describe('profile-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'alice@example.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 invalid bearer token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ first_name: 'Alice' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 empty body — no updatable fields
  it('returns 400 when no updatable fields are provided', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No updatable fields provided' });
  });

  // 4. 400 preferred_language not in {en, da}
  it('returns 400 when preferred_language is invalid', async () => {
    const res = await handler(baseReq({ preferred_language: 'fr' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: "preferred_language must be 'en' or 'da'" });
  });

  // 5. 400 first_name empty string
  it('returns 400 when first_name is an empty string', async () => {
    const res = await handler(baseReq({ first_name: '   ' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'first_name must not be empty' });
  });

  // 6. 400 last_name without first_name
  it('returns 400 when last_name is provided without first_name', async () => {
    const res = await handler(baseReq({ last_name: 'Smith' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'first_name is required when last_name is provided' });
  });

  // 7. Happy path: profile-fields update with first_name + last_name
  it('updates name fields and derives full_name; WHERE uses own profile id', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...profileRow, first_name: 'Bob', last_name: 'Jones', full_name: 'Bob Jones' });

    const res = await handler(baseReq({ first_name: 'Bob', last_name: 'Jones' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profile).toBeDefined();

    // Assert SQL contains full_name derivation and WHERE is by profile id
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('full_name');
    expect(sql).toContain('first_name');
    expect(sql).toContain('last_name');
    expect(sql).toContain('WHERE id =');
    expect(params).toContain('p1');
    expect(params).toContain('Bob');
    expect(params).toContain('Jones');
    expect(params).toContain('Bob Jones');
  });

  // 8. Happy path: language-only update — SET must NOT touch full_name
  it('updates only preferred_language; SQL does not touch full_name', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...profileRow, preferred_language: 'da' });

    const res = await handler(baseReq({ preferred_language: 'da' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profile).toBeDefined();

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('preferred_language');
    // The SET clause must NOT touch full_name (language-only update)
    const setClause = sql.split('RETURNING')[0];
    expect(setClause).not.toContain('full_name');
    expect(params).toContain('da');
    expect(params).toContain('p1');
  });

  // 9. Empty-string last_name and department → stored as NULL
  it('stores empty-string last_name and department as NULL', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...profileRow, last_name: null, department: null });

    const res = await handler(baseReq({ first_name: 'Alice', last_name: '', department: '' }), {} as any);

    expect(res.status).toBe(200);

    const [_sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    // last_name param should be null (empty string → NULL)
    expect(params).toContain(null);
    // full_name should be just first_name when last_name is empty
    expect(params).toContain('Alice');
    // department param should also be null
    const nullCount = params.filter((p) => p === null).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });

  // 10. 500 on db error propagates message
  it('returns 500 when the database throws', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ preferred_language: 'en' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
