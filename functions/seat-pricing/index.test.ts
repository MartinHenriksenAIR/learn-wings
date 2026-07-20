import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQueryOne: vi.fn(), mockGetProfile: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/db')>()),
  query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const req = () => ({ method: 'POST', headers: { get: () => 'https://ai-uddannelse.dk' }, json: async () => ({}) }) as any;

describe('seat-pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler({ method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns the configured price and currency, never the notification email', async () => {
    mockQueryOne.mockResolvedValueOnce({ value: { annual_price_per_seat: 1200, currency: 'DKK', notification_email: 'jacob@ai-raadgivning.dk' } });
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ pricing: { annual_price_per_seat: 1200, currency: 'DKK' } });
  });

  it('defaults to null price / DKK when the setting row is absent', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(req(), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ pricing: { annual_price_per_seat: null, currency: 'DKK' } });
  });
});
