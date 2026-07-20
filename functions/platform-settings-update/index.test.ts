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

  // 7b. 400 when value contains an unknown field for the setting key
  it('returns 400 when value contains an unknown field', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'branding', value: { logo: 'new-logo.png' } }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/unknown field "logo"/);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 7c. 400 when a known field has the wrong shape
  it('returns 400 when a known field has the wrong type', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'features', value: { quizzes_enabled: 'yes' } }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/invalid value for field "quizzes_enabled"/);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 7d. 400 when an enum field has a value outside its set
  it('returns 400 when smtp_encryption is not a known mode', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'email', value: { smtp_encryption: 'tls' } }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/invalid value for field "smtp_encryption"/);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 7e. 400 when smtp_port is not a number
  it('returns 400 when smtp_port is not a number', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const res = await handler(baseReq({ key: 'email', value: { smtp_port: '587' } }), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toMatch(/invalid value for field "smtp_port"/);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  // 8. Happy path — correct SQL, params, and response shape; write MERGES per key
  it('updates the setting via a jsonb merge and returns the updated row', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const updatedRow = { key: 'branding', value: { logo_url: 'new-logo.png' } };
    mockQueryOne.mockResolvedValueOnce(updatedRow);

    const res = await handler(baseReq({ key: 'branding', value: { logo_url: 'new-logo.png' } }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ setting: updatedRow });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('platform_settings');
    expect(sql).toContain('updated_by');
    // Merge semantics pinned: stored value is the base, body fields overlay it —
    // absent fields keep their stored values (no more blind replace).
    expect(sql).toContain('value = value || $2::jsonb');
    // params: [key, JSON.stringify(value), profile.id]
    expect(params[0]).toBe('branding');
    expect(params[1]).toBe(JSON.stringify({ logo_url: 'new-logo.png' }));
    expect(params[2]).toBe('p1');
  });

  // 8b. Partial body only sends the present fields into the merge
  it('a partial body merges only the fields present (stored SMTP config survives)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const updatedRow = { key: 'email', value: { from_name: 'New Name', smtp_host: 'smtp.kept.example' } };
    mockQueryOne.mockResolvedValueOnce(updatedRow);

    const res = await handler(baseReq({ key: 'email', value: { from_name: 'New Name' } }), {} as any);

    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('value = value || $2::jsonb');
    expect(params[1]).toBe(JSON.stringify({ from_name: 'New Name' }));
  });

  // 8c. Full-body write still works
  it('a full-body write passes validation and merges all fields', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const fullEmail = {
      from_name: 'AIR Academy',
      from_email: 'noreply@example.com',
      smtp_configured: true,
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_username: 'smtp-user',
      smtp_password: 'secret',
      smtp_encryption: 'starttls',
    };
    mockQueryOne.mockResolvedValueOnce({ key: 'email', value: fullEmail });

    const res = await handler(baseReq({ key: 'email', value: fullEmail }), {} as any);

    expect(res.status).toBe(200);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(JSON.stringify(fullEmail));
  });

  // 9. 404 when no row updated (key not in DB)
  it('returns 404 when the setting key does not exist in the DB', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ key: 'features', value: { quizzes_enabled: true } }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Setting not found' });
  });

  // 10. 500 on db error
  it('returns 500 on db error', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ key: 'email', value: { smtp_host: 'x' } }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // 11. seat_pricing — accepts a valid update
  it('accepts a valid seat_pricing update', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ key: 'seat_pricing', value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }), {} as any);
    expect(res.status).toBe(200);
  });

  // 12. seat_pricing — accepts a null seat price (unsetting)
  it('accepts a null seat price (unsetting)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ key: 'seat_pricing', value: { annual_price_per_seat: null } });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: null } }), {} as any);
    expect(res.status).toBe(200);
  });

  // 13. seat_pricing — rejects a negative seat price
  it('rejects a negative seat price', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { annual_price_per_seat: -5 } }), {} as any);
    expect(res.status).toBe(400);
  });

  // 14. seat_pricing — rejects an unknown field
  it('rejects an unknown seat_pricing field', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const res = await handler(baseReq({ key: 'seat_pricing', value: { bogus: 1 } }), {} as any);
    expect(res.status).toBe(400);
  });
});
