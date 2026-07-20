import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError, mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const rows = (...r: unknown[]) => ({ rows: r });
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-request-fulfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'admin-1', is_platform_admin: true });
  });

  it('returns 403 for a non-platform-admin (adminEndpoint gate)', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    expect((await handler(baseReq({ id: 'req-1' }), {} as any)).status).toBe(403);
  });

  it('returns 400 when id missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });

  it('returns 404 when the request does not exist', async () => {
    mockClientQuery.mockResolvedValueOnce(rows()); // request lock: none
    expect((await handler(baseReq({ id: 'req-x' }), {} as any)).status).toBe(404);
  });

  it('returns 409 NOT_PENDING when already fulfilled', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'fulfilled', additional_seats: 5 }));
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('NOT_PENDING');
  });

  it('returns 409 ORG_UNLIMITED when the org has no seat limit', async () => {
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'pending', additional_seats: 5 }));
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: null }));
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('ORG_UNLIMITED');
  });

  it('bumps seat_limit and marks fulfilled', async () => {
    const fulfilled = { id: 'req-1', org_id: 'org-1', additional_seats: 5, status: 'fulfilled', unit_price_snapshot: 1200, currency: 'DKK', fulfilled_at: '2026-07-20T12:00:00.000Z' };
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'pending', additional_seats: 5 })); // request lock
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 10 }));  // org lock
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 15 }));  // bump
    mockClientQuery.mockResolvedValueOnce(rows(fulfilled));           // mark fulfilled
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: fulfilled, seatLimit: 15 });
    const [bumpSql, bumpParams] = mockClientQuery.mock.calls[2] as [string, unknown[]];
    expect(bumpSql).toContain('UPDATE organizations SET seat_limit = seat_limit +');
    expect(bumpParams).toEqual(['org-1', 5]);
  });
});
