import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
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

const validBody = { nameEn: 'Machine Learning', nameDa: 'Maskinlæring' };

const fakeCategory = {
  id: 'cat-1',
  name_en: 'Machine Learning',
  name_da: 'Maskinlæring',
  slug: 'machine-learning',
  sort_order: 3,
};

describe('course-category-create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockQuery.mockResolvedValue([]); // no existing slugs by default
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
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when nameEn is missing', async () => {
    const res = await handler(baseReq({ nameDa: 'Maskinlæring' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'nameEn is required' });
  });

  it('returns 400 when nameEn is empty/whitespace', async () => {
    const res = await handler(baseReq({ nameEn: '   ', nameDa: 'Maskinlæring' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'nameEn is required' });
  });

  it('returns 400 when nameEn is not a string', async () => {
    const res = await handler(baseReq({ nameEn: 42, nameDa: 'Maskinlæring' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'nameEn is required' });
  });

  it('returns 400 when nameDa is missing', async () => {
    const res = await handler(baseReq({ nameEn: 'Machine Learning' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'nameDa is required' });
  });

  it('happy path: derives slug from nameEn, appends sort_order, inserts trimmed names', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCategory);

    const res = await handler(baseReq({ nameEn: '  Machine Learning  ', nameDa: '  Maskinlæring  ' }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ category: fakeCategory });

    const [lookupSql, lookupParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(lookupSql).toContain('SELECT slug FROM course_categories');
    expect(lookupParams[0]).toBe('machine-learning');
    expect(lookupParams[1]).toBe('machine-learning-%');

    const [insertSql, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain('INSERT INTO course_categories');
    expect(insertSql).toContain('COALESCE(MAX(sort_order), 0) + 1');
    expect(insertSql).toContain('RETURNING *');
    expect(insertParams[0]).toBe('Machine Learning'); // trimmed name_en
    expect(insertParams[1]).toBe('Maskinlæring');      // trimmed name_da
    expect(insertParams[2]).toBe('machine-learning');  // slug
  });

  it('suffixes the slug when the base is already taken (-2, -3, …)', async () => {
    mockQuery.mockResolvedValueOnce([{ slug: 'machine-learning' }, { slug: 'machine-learning-2' }]);
    mockQueryOne.mockResolvedValueOnce({ ...fakeCategory, slug: 'machine-learning-3' });

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    const [, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(insertParams[2]).toBe('machine-learning-3');
  });

  it("falls back to 'category' when nameEn has no slug-able characters", async () => {
    mockQueryOne.mockResolvedValueOnce({ ...fakeCategory, slug: 'category' });

    const res = await handler(baseReq({ nameEn: '!!!', nameDa: 'Ukendt' }), {} as any);

    expect(res.status).toBe(200);
    const [, lookupParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(lookupParams[0]).toBe('category');
    const [, insertParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(insertParams[2]).toBe('category');
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
