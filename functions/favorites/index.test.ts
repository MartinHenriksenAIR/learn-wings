import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: mockQuery, queryOne: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const validBody = { orgId: 'org-1' };

describe('favorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(true);
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

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is wrong type', async () => {
    const res = await handler(baseReq({ orgId: 42 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 403 when caller is not an active member of the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('happy path: returns the org-visible favorited courses', async () => {
    const courses = [
      { id: 'c1', title: 'Alpha', description: null, level: 'beginner', language: 'da', is_published: true, thumbnail_url: null, created_by_user_id: 'admin-1', created_at: '2026-08-01T00:00:00.000Z' },
      { id: 'c2', title: 'Beta', description: null, level: 'beginner', language: 'da', is_published: true, thumbnail_url: null, created_by_user_id: 'admin-1', created_at: '2026-08-02T00:00:00.000Z' },
    ];
    mockQuery.mockResolvedValueOnce(courses);

    const res = await handler(baseReq(validBody), {} as any);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ courses });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM course_favorites f');
    expect(sql).toContain('JOIN courses c ON c.id = f.course_id');
    expect(sql).toContain('f.user_id = $1');
    expect(sql).toContain('ORDER BY f.created_at DESC');
    // Reuses the shared visibility predicate against orgParam=$2.
    expect(sql).toContain("oca.org_id = $2");
    expect(sql).toContain('c.is_published = TRUE');
    expect(params).toEqual(['p1', 'org-1']);
  });

  it('happy path (empty): returns { courses: [] }', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ courses: [] });
  });
});
