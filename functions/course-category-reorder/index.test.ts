import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockWithTransaction, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockWithTransaction: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: mockWithTransaction, getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { orderedIds: ['cat-b', 'cat-a'] };

describe('course-category-reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when orderedIds is not an array', async () => {
    const res = await handler(baseReq({ orderedIds: 'nope' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orderedIds must be a non-empty array' });
  });

  it('returns 400 when orderedIds is empty', async () => {
    const res = await handler(baseReq({ orderedIds: [] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orderedIds must be a non-empty array' });
  });

  it('returns 400 when orderedIds contains a non-string', async () => {
    const res = await handler(baseReq({ orderedIds: ['cat-a', 42] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orderedIds must contain only strings' });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it('happy path: sets sort_order = index per id in one transaction, returns reordered list', async () => {
    const reordered = [
      { id: 'cat-b', name_en: 'Beta', name_da: 'Beta', slug: 'beta', sort_order: 0 },
      { id: 'cat-a', name_en: 'Alpha', name_da: 'Alfa', slug: 'alpha', sort_order: 1 },
    ];
    const mockClientQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })        // UPDATE cat-b → 0
      .mockResolvedValueOnce({ rows: [] })        // UPDATE cat-a → 1
      .mockResolvedValueOnce({ rows: reordered }); // final SELECT
    mockWithTransaction.mockImplementationOnce(async (cb: any) => cb({ query: mockClientQuery }));

    const res = await handler(baseReq({ orderedIds: ['cat-b', 'cat-a'] }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ categories: reordered });

    expect(mockClientQuery).toHaveBeenCalledTimes(3);

    const [upd0Sql, upd0Params] = mockClientQuery.mock.calls[0] as [string, unknown[]];
    expect(upd0Sql).toContain('UPDATE course_categories SET sort_order = $1');
    expect(upd0Params).toEqual([0, 'cat-b']);

    const [, upd1Params] = mockClientQuery.mock.calls[1] as [string, unknown[]];
    expect(upd1Params).toEqual([1, 'cat-a']);

    const [selSql] = mockClientQuery.mock.calls[2] as [string, unknown[]];
    expect(selSql).toContain('SELECT * FROM course_categories');
    expect(selSql).toContain('ORDER BY sort_order');
  });

  it('returns 500 when the transaction throws', async () => {
    mockWithTransaction.mockImplementationOnce(async (cb: any) => {
      const client = { query: vi.fn().mockRejectedValueOnce(new Error('FK violation')) };
      return cb(client);
    });
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
