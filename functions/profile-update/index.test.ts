import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockDeleteBlob } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockDeleteBlob: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/blob', () => ({ deleteBlob: mockDeleteBlob }));

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

/**
 * When (and only when) `avatar_url` is in the body, the endpoint issues a
 * previous-avatar SELECT before the UPDATE — so queryOne is called twice.
 */
const mockAvatarDb = (previousAvatarUrl: string | null, updated: unknown = profileRow) => {
  mockQueryOne.mockResolvedValueOnce({ avatar_url: previousAvatarUrl }).mockResolvedValueOnce(updated);
};

describe('profile-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'alice@example.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockDeleteBlob.mockResolvedValue(true);
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

  // 9b. avatar_url round-trips through the update as the raw container-relative path
  it('updates avatar_url with the raw container-relative path', async () => {
    mockAvatarDb(null, { ...profileRow, avatar_url: 'avatars/abc.png' });

    const res = await handler(baseReq({ avatar_url: 'avatars/abc.png' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.profile.avatar_url).toBe('avatars/abc.png');

    // calls[0] is the previous-avatar SELECT; calls[1] is the UPDATE.
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    // SET touches avatar_url but NOT full_name (avatar-only update)
    const setClause = sql.split('RETURNING')[0];
    expect(setClause).toContain('avatar_url =');
    expect(setClause).not.toContain('full_name');
    expect(params).toContain('avatars/abc.png');
    expect(params).toContain('p1');
  });

  // 9c. empty-string avatar_url clears the photo (stored as NULL)
  it('stores empty-string avatar_url as NULL (clears the photo)', async () => {
    mockAvatarDb(null, { ...profileRow, avatar_url: null });

    const res = await handler(baseReq({ avatar_url: '' }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(sql.split('RETURNING')[0]).toContain('avatar_url =');
    expect(params).toContain(null);
  });

  // 10. 404 when the profile row vanishes between getProfile and the UPDATE
  it('returns 404 when the UPDATE matches no row (profile deleted mid-request)', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // UPDATE ... RETURNING → no row

    const res = await handler(baseReq({ preferred_language: 'da' }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 11. 500 on db error propagates message
  it('returns 500 when the database throws', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ preferred_language: 'en' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // --- Superseded-avatar cleanup (#275) ---

  it('avatar replaced: deletes the OLD blob exactly once', async () => {
    mockAvatarDb('avatars/old.png', { ...profileRow, avatar_url: 'avatars/new.png' });

    const res = await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('avatars/old.png');
  });

  it('avatar cleared with an empty string: deletes the OLD blob', async () => {
    mockAvatarDb('avatars/old.png', { ...profileRow, avatar_url: null });

    const res = await handler(baseReq({ avatar_url: '' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockDeleteBlob).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).toHaveBeenCalledWith('avatars/old.png');
  });

  it('avatar unchanged: deletes nothing', async () => {
    mockAvatarDb('avatars/keep.png', { ...profileRow, avatar_url: 'avatars/keep.png' });

    const res = await handler(baseReq({ avatar_url: 'avatars/keep.png' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('old avatar was null: deletes nothing', async () => {
    mockAvatarDb(null, { ...profileRow, avatar_url: 'avatars/new.png' });

    const res = await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('avatar_url absent from the body is NOT a clear: no SELECT, no delete', async () => {
    mockQueryOne.mockResolvedValueOnce(profileRow); // single call — the UPDATE

    const res = await handler(baseReq({ first_name: 'Bob' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('reads the previous avatar with a SELECT scoped to the caller own id', async () => {
    mockAvatarDb('avatars/old.png');

    await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    const [selectSql, selectParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toMatch(/SELECT avatar_url FROM profiles/i);
    // id comes from the authenticated profile, never from the body
    expect(selectParams).toEqual(['p1']);
  });

  it('404 (profile vanished mid-request): deletes nothing', async () => {
    mockAvatarDb('avatars/old.png', null);

    const res = await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(res.status).toBe(404);
    expect(mockDeleteBlob).not.toHaveBeenCalled();
  });

  it('deleteBlob returns false: request still succeeds with its normal body', async () => {
    const updated = { ...profileRow, avatar_url: 'avatars/new.png' };
    mockAvatarDb('avatars/old.png', updated);
    mockDeleteBlob.mockResolvedValue(false);

    const res = await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(res.status).toBe(200);
    // Cleanup outcome is deliberately NOT surfaced in the response.
    expect(JSON.parse(res.body as string)).toEqual({ profile: updated });
  });

  it('storage fetch rejects (helper swallows it → false): request still succeeds', async () => {
    const updated = { ...profileRow, avatar_url: 'avatars/new.png' };
    mockAvatarDb('avatars/old.png', updated);
    mockDeleteBlob.mockResolvedValue(false); // deleteBlob never throws — a rejected fetch surfaces as false

    const res = await handler(baseReq({ avatar_url: 'avatars/new.png' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ profile: updated });
  });
});
