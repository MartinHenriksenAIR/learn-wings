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
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(),
  queryOne: mockQueryOne,
  withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const SKIP_TS = '2026-07-20T10:00:00.000Z';

const baseReq = () => ({
  method: 'POST',
  headers: { get: () => 'https://ai-uddannelse.dk' },
  json: async () => ({}),
}) as any;

describe('assessment-skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockQueryOne.mockResolvedValue({ assessment_skipped_at: SKIP_TS });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'x' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Unauthorized'));
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when profile not found', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
  });

  it('happy path: first skip — returns the timestamp', async () => {
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ skipped_at: SKIP_TS });
  });

  it('idempotency: repeat skip returns the original timestamp (COALESCE preserves first)', async () => {
    // Mock simulates the DB honouring COALESCE — returns the already-existing timestamp.
    mockQueryOne.mockResolvedValueOnce({ assessment_skipped_at: SKIP_TS });
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.skipped_at).toBe(SKIP_TS);

    // Assert the SQL uses COALESCE so first-skip is preserved server-side.
    const [sql] = mockQueryOne.mock.calls[0] as [string];
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('assessment_skipped_at');
    expect(sql).toContain('RETURNING');
  });

  it('passes the profile id as the WHERE param', async () => {
    await handler(baseReq(), {} as any);
    const [, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['p1']);
  });
});
