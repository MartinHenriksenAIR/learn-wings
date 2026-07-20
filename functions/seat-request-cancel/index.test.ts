import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';
const baseReq = (body: unknown) => ({ method: 'POST', headers: { get: () => 'x' }, json: async () => body }) as any;

describe('seat-request-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: true });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('returns 400 when id missing', async () => {
    expect((await handler(baseReq({}), {} as any)).status).toBe(400);
  });

  it('returns 404 when the request does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // existence lookup
    expect((await handler(baseReq({ id: 'req-x' }), {} as any)).status).toBe(404);
  });

  it('returns 403 when the caller is not org admin of the request org', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'pending' });
    mockIsOrgAdmin.mockResolvedValueOnce(false);
    expect((await handler(baseReq({ id: 'req-1' }), {} as any)).status).toBe(403);
  });

  it('cancels a pending request', async () => {
    const cancelled = { id: 'req-1', org_id: 'org-1', status: 'cancelled', additional_seats: 5, unit_price_snapshot: 1200, currency: 'DKK', cancelled_at: '2026-07-20T11:00:00.000Z' };
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'pending' }); // existence
    mockQueryOne.mockResolvedValueOnce(cancelled);                               // conditional update
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ request: cancelled });
  });

  it('returns 409 NOT_PENDING when the request is not pending', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-1', status: 'fulfilled' }); // existence
    mockQueryOne.mockResolvedValueOnce(null);                                     // conditional update matched 0 rows
    const res = await handler(baseReq({ id: 'req-1' }), {} as any);
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body as string).code).toBe('NOT_PENDING');
  });
});
