import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockClientQuery, mockWithTransaction, mockQueryOne, mockGetProfile, mockIsOrgAdmin, mockNotify, mockNotifyReceived } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  const mockClientQuery = vi.fn();
  return {
    mockAuthenticate: vi.fn(), MockAuthError, mockClientQuery,
    mockWithTransaction: vi.fn(async (cb: (c: { query: typeof mockClientQuery }) => unknown) => cb({ query: mockClientQuery })),
    mockQueryOne: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(), mockNotify: vi.fn(), mockNotifyReceived: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: mockWithTransaction,
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));
vi.mock('../shared/seat-request-notify', () => ({ notifySeatRequest: mockNotify, notifySeatRequestReceived: mockNotifyReceived }));

import handler from './index';

const rows = (...r: unknown[]) => ({ rows: r });
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'https://ai-uddannelse.dk' }, json: async () => body }) as any;
const valid = { orgId: 'org-1', additionalSeats: 5 };
const orgRow = (seat_limit: number | null) => ({ name: 'Acme', seat_limit, active_count: 10, pending_count: 0 });
const inserted = { id: 'req-1', org_id: 'org-1', requested_by_user_id: 'p1', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', status: 'pending', created_at: '2026-07-20T10:00:00.000Z' };

describe('seat-request-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (cb) => cb({ query: mockClientQuery }));
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
    // Default: price configured. queryOne is called for (1) seat_pricing then (2) requester profile.
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('platform_settings')
        ? { value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }
        : { full_name: 'Mette', email: 'mette@acme.dk' });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'x' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await handler(baseReq({ additionalSeats: 5 }), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when additionalSeats is not a positive integer', async () => {
    for (const bad of [0, -3, 2.5, 1001, 'x']) {
      const res = await handler(baseReq({ orgId: 'org-1', additionalSeats: bad }), {} as any);
      expect(res.status).toBe(400);
    }
  });

  it('returns 403 when caller is not an org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 409 SEAT_PRICING_UNCONFIGURED when no price is set', async () => {
    mockQueryOne.mockImplementationOnce(async () => ({ value: { annual_price_per_seat: null, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } }));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('SEAT_PRICING_UNCONFIGURED');
  });

  it('returns 404 when the org does not exist', async () => {
    mockClientQuery.mockResolvedValueOnce(rows()); // org lock returns nothing
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 409 ORG_UNLIMITED when the org has no seat limit', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(null)));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('ORG_UNLIMITED');
  });

  it('happy path: snapshots the server price, inserts, notifies, returns the request', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(10))); // org lock
    mockClientQuery.mockResolvedValueOnce(rows(inserted));   // insert
    const res = await handler(baseReq(valid), { error: vi.fn() } as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: inserted });
    // price came from the setting, not the client (client sent none anyway)
    const [insertSql, insertParams] = mockClientQuery.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO seat_requests');
    expect(insertParams).toEqual(['org-1', 'p1', 5, 1200, 'DKK']);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][1]).toMatchObject({ recipient: 'jacob@ai-raadgivning.dk', orgName: 'Acme', additionalSeats: 5, unitPrice: 1200 });
    // requester-facing email goes to the requester only, not the platform admin
    expect(mockNotifyReceived).toHaveBeenCalledTimes(1);
    expect(mockNotifyReceived.mock.calls[0][1]).toMatchObject({ recipient: 'mette@acme.dk', orgName: 'Acme', additionalSeats: 5 });
  });

  it('returns 409 REQUEST_ALREADY_PENDING on the unique-index violation', async () => {
    mockClientQuery.mockResolvedValueOnce(rows(orgRow(10)));
    mockClientQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await handler(baseReq(valid), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('REQUEST_ALREADY_PENDING');
  });
});
