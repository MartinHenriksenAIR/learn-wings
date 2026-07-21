import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'admin-oid', tid: 'tid-1', email: 'admin@contoso.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockGetProfile, mockClientQuery, mockWithTransaction } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  return {
    mockGetProfile: vi.fn(),
    mockClientQuery,
    // withTransaction runs its callback against a mock client — the real
    // BEGIN/COMMIT/FOR UPDATE is exercised by the DATABASE_URL-gated integration
    // tests in shared/db.test.ts. Here we assert the count-then-update contract.
    mockWithTransaction: vi.fn(async (cb: (client: { query: typeof mockClientQuery }) => unknown) =>
      cb({ query: mockClientQuery }),
    ),
  };
});
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('../shared/db', () => ({ withTransaction: mockWithTransaction }));

import handler from './index';

const baseReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
});

const admin = () => mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

describe('platform-admin-update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when the caller is not a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p9', is_platform_admin: false });

    const res = await handler(baseReq({ userId: 'p2', grant: true }) as any, {} as any);

    expect(res.status).toBe(403);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when userId is missing', async () => {
    admin();
    const res = await handler(baseReq({ grant: true }) as any, {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when grant is not a boolean', async () => {
    admin();
    const res = await handler(baseReq({ userId: 'p2' }) as any, {} as any);
    expect(res.status).toBe(400);
  });

  it('grants platform admin to an existing user', async () => {
    admin();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] })            // lock current admins
      .mockResolvedValueOnce({ rows: [{ id: 'p2' }] })            // target exists
      .mockResolvedValueOnce({ rows: [] });                        // UPDATE grant

    const res = await handler(baseReq({ userId: 'p2', grant: true }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const updateCall = mockClientQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE profiles'));
    expect(updateCall![0]).toContain('is_platform_admin = true');
    expect(updateCall![1]).toEqual(['p2']);
  });

  it('revokes platform admin when other admins remain', async () => {
    admin();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] }) // two admins locked
      .mockResolvedValueOnce({ rows: [{ id: 'p2' }] })              // target exists
      .mockResolvedValueOnce({ rows: [] });                          // UPDATE revoke

    const res = await handler(baseReq({ userId: 'p2', grant: false }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const updateCall = mockClientQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE profiles'));
    expect(updateCall![0]).toContain('is_platform_admin = false');
    expect(updateCall![1]).toEqual(['p2']);
  });

  it('HARD-REFUSES demoting the last remaining platform admin (no UPDATE)', async () => {
    admin();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] }) // only one admin locked
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] }); // target is that admin

    const res = await handler(baseReq({ userId: 'p1', grant: false }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: 'Cannot remove the last platform admin', code: 'LAST_ADMIN' });
    const updateCall = mockClientQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE profiles'));
    expect(updateCall).toBeUndefined();
  });

  it('returns 404 when the target user does not exist', async () => {
    admin();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }] }) // admins
      .mockResolvedValueOnce({ rows: [] });             // target missing

    const res = await handler(baseReq({ userId: 'ghost', grant: true }) as any, {} as any);

    expect(res.status).toBe(404);
  });
});
