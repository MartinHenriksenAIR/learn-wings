import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockQueryOne, mockGetProfile, mockNotifyFulfilled } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError, mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
    mockQueryOne: vi.fn(), mockGetProfile: vi.fn(), mockNotifyFulfilled: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));
vi.mock('../shared/seat-request-notify', () => ({ notifySeatRequestFulfilled: mockNotifyFulfilled }));

import handler from './index';
const rows = (...r: unknown[]) => ({ rows: r });
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-request-fulfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'admin-1', is_platform_admin: true });
    // Post-fulfilment lookups: (1) requester profile, (2) organization name.
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM profiles')
        ? { email: 'requester@acme.dk', preferred_language: 'en' }
        : { name: 'Acme' });
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
    const res = await handler(baseReq({ id: 'req-1' }), { error: vi.fn(), log: vi.fn() } as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: fulfilled, seatLimit: 15 });
    const [bumpSql, bumpParams] = mockClientQuery.mock.calls[2] as [string, unknown[]];
    expect(bumpSql).toContain('UPDATE organizations SET seat_limit = seat_limit +');
    expect(bumpParams).toEqual(['org-1', 5]);
    // requester-facing "seats active" email, to the requester only, with the new limit
    expect(mockNotifyFulfilled).toHaveBeenCalledTimes(1);
    expect(mockNotifyFulfilled.mock.calls[0][1]).toMatchObject({ recipient: 'requester@acme.dk', orgName: 'Acme', additionalSeats: 5, seatLimit: 15, language: 'en' });
  });

  it('still returns 200 when the post-fulfilment notification lookups fail', async () => {
    const fulfilled = { id: 'req-1', org_id: 'org-1', requested_by_user_id: 'user-9', additional_seats: 5, status: 'fulfilled' };
    mockClientQuery.mockResolvedValueOnce(rows({ org_id: 'org-1', status: 'pending', additional_seats: 5 }));
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 10 }));
    mockClientQuery.mockResolvedValueOnce(rows({ seat_limit: 15 }));
    mockClientQuery.mockResolvedValueOnce(rows(fulfilled));
    mockQueryOne.mockRejectedValue(new Error('transient db error')); // requester/org lookups blow up
    const context = { error: vi.fn(), log: vi.fn() } as any;
    const res = await handler(baseReq({ id: 'req-1' }), context);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: fulfilled, seatLimit: 15 });
    expect(mockNotifyFulfilled).not.toHaveBeenCalled();
    expect(context.error).toHaveBeenCalled();
  });
});
