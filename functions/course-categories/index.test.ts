import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn(), withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('course-categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 200 with categories for any authenticated caller, ordered by sort_order', async () => {
    const rows = [
      { id: 'cat-1', name_en: 'General', name_da: 'Generelt', slug: 'general', sort_order: 0 },
      { id: 'cat-2', name_en: 'News', name_da: 'Nyheder', slug: 'news', sort_order: 1 },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ categories: rows });

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('course_categories');
    expect(sql).toContain('ORDER BY sort_order');
    expect(params).toEqual([]);
  });

  it('returns 200 with an empty list when no categories exist', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ categories: [] });
  });

  it('platform admin also gets categories', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'cat-1', name_en: 'General', name_da: 'Generelt', slug: 'general', sort_order: 0 }];
    mockQuery.mockResolvedValueOnce(rows);
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ categories: rows });
  });

  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({}), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
