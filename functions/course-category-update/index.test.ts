import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: vi.fn(), queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
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

const validBody = { categoryId: 'cat-1', updates: { nameEn: 'New Name' } };

const fakeCategory = {
  id: 'cat-1',
  name_en: 'New Name',
  name_da: 'Nyt Navn',
  slug: 'machine-learning', // unchanged by rename
  sort_order: 2,
};

describe('course-category-update', () => {
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
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when categoryId is missing', async () => {
    const res = await handler(baseReq({ updates: { nameEn: 'X' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId is required' });
  });

  it('returns 400 when categoryId is not a string', async () => {
    const res = await handler(baseReq({ categoryId: 7, updates: { nameEn: 'X' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'categoryId is required' });
  });

  it('returns 400 when updates is not an object', async () => {
    const res = await handler(baseReq({ categoryId: 'cat-1', updates: 'nope' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'updates must be an object' });
  });

  it('returns 400 when a provided name is empty', async () => {
    const res = await handler(baseReq({ categoryId: 'cat-1', updates: { nameEn: '   ' } }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'nameEn must be a non-empty string' });
  });

  it('returns 400 when no update fields are provided', async () => {
    const res = await handler(baseReq({ categoryId: 'cat-1', updates: {} }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'No update fields provided' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('happy path: updates a single name, does not touch slug or sort_order', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCategory);

    const res = await handler(baseReq({ categoryId: 'cat-1', updates: { nameEn: '  New Name  ' } }), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ category: fakeCategory });

    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE course_categories SET name_en = $1');
    expect(sql).toContain('WHERE id = $2');
    expect(sql).toContain('RETURNING *');
    expect(sql).not.toContain('slug');
    expect(sql).not.toContain('sort_order');
    expect(params).toEqual(['New Name', 'cat-1']); // trimmed name, then id
  });

  it('happy path: updates both names in body order', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCategory);

    const res = await handler(
      baseReq({ categoryId: 'cat-1', updates: { nameEn: 'New Name', nameDa: 'Nyt Navn' } }),
      {} as any,
    );

    expect(res.status).toBe(200);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('name_en = $1');
    expect(sql).toContain('name_da = $2');
    expect(sql).toContain('WHERE id = $3');
    expect(params).toEqual(['New Name', 'Nyt Navn', 'cat-1']);
  });

  it('returns 404 when the category does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Category not found' });
  });

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
