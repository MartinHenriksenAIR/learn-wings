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

describe('unenroll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 enrollmentId missing
  it('returns 400 when enrollmentId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'enrollmentId is required' });
  });

  // 4. Happy path: DELETE returns row → 200 {success:true}
  //    SECURITY PIN: SQL must contain user_id = $2; params must be exactly ['e-1', 'p1']
  it('returns 200 on success and enforces ownership via WHERE user_id = $2', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'e-1' });

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ success: true });

    // SECURITY PIN: ownership enforced via DELETE WHERE clause
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_id = $2');
    expect(params).toEqual(['e-1', 'p1']);
  });

  // 5. 404 not found / not owned: queryOne null → 404
  it('returns 404 when enrollment not found or belongs to another user', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Enrollment not found' });
  });

  // 6. Platform admin gets NO bypass — same DELETE SQL with user_id = $2, params ['e-1','p-admin']
  it('platform admin gets no bypass: same DELETE WHERE user_id = $2 applies', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p-admin', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), {} as any);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Enrollment not found' });

    // Admin's profile.id is used in the WHERE, no bypass
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('user_id = $2');
    expect(params).toEqual(['e-1', 'p-admin']);
  });

  // 7. 500 db error
  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ enrollmentId: 'e-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
