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
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('platform-settings-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 when bearer token invalid
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 when profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 403 for non-admin — no DB call
  it('returns 403 for non-admin without querying the DB', async () => {
    const res = await handler(baseReq({ key: 'branding', value: {} }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 4. 400 for invalid key
  it('returns 400 when key is not an allowed setting key', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'unknown_key', value: {} }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/key must be one of/);
  });

  // 5. 400 when value is null
  it('returns 400 when value is null', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'branding', value: null }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/plain object/);
  });

  // 6. 400 when value is an array
  it('returns 400 when value is an array', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'branding', value: ['a', 'b'] }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/plain object/);
  });

  // 7. 400 when value is a non-object primitive
  it('returns 400 when value is a string', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'branding', value: 'some string' }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/plain object/);
  });

  // 8. Happy path — correct SQL, params, and response shape
  it('updates the setting and returns the updated row', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const updatedRow = { key: 'branding', value: { logo: 'new-logo.png' } };
    mockQueryOne.mockResolvedValueOnce(updatedRow);

    const res = await handler(baseReq({ key: 'branding', value: { logo: 'new-logo.png' } }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ setting: updatedRow });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('platform_settings');
    expect(sql).toContain('updated_by');
    // params: [key, JSON.stringify(value), profile.id]
    expect(params[0]).toBe('branding');
    expect(params[1]).toBe(JSON.stringify({ logo: 'new-logo.png' }));
    expect(params[2]).toBe('p1');
  });

  // 9. 404 when no row updated (key not in DB)
  it('returns 404 when the setting key does not exist in the DB', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ key: 'features', value: { flag: true } }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Setting not found' });
  });

  // 10. 500 on db error
  it('returns 500 on db error', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ key: 'email', value: { smtp_host: 'x' } }), {} as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
