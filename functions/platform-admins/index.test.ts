import { describe, it, expect, vi, beforeEach } from 'vitest';

// The endpoint factory calls authenticate → getProfile; adminEndpoint gates on
// profile.is_platform_admin BEFORE the handler runs. Mock exactly those module
// names (shared/auth, shared/profile, shared/db) — never a real DB.
vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-oid', tid: 'tid-1', email: 'admin@contoso.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockGetProfile, mockQuery } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  mockQuery: vi.fn(),
}));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/db', () => ({ query: mockQuery }));

import handler from './index';

const baseReq = () => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => ({}),
});

describe('platform-admins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when the caller is not a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: false });

    const res = await handler(baseReq() as any, {} as any);

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns the list of platform admins for a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [
      { id: 'p1', full_name: 'Ada Admin', email: 'ada@contoso.com' },
      { id: 'p2', full_name: 'Bo Boss', email: 'bo@contoso.com' },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq() as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.admins).toEqual(rows);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('is_platform_admin = true');
  });
});
