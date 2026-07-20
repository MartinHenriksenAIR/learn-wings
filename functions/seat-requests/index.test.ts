import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQuery: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: mockQuery, queryOne: vi.fn(), withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('returns 400 when orgId missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not an org admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
  });

  it('lists the org requests (platform admin bypass)', async () => {
    const requests = [{ id: 'req-1', org_id: 'org-1', status: 'pending', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', requester_name: 'Mette', requester_email: 'mette@acme.dk' }];
    mockQuery.mockResolvedValueOnce(requests);
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ requests });
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM seat_requests');
    expect(params).toEqual(['org-1']);
  });
});
