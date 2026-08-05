import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(), mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../shared/db')>()), query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn(), isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const addBody = { orgId: 'org-1', courseId: 'course-1', favorite: true };
const removeBody = { orgId: 'org-1', courseId: 'course-1', favorite: false };

describe('favorite-set', () => {
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
    const res = await handler(baseReq(addBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(addBody), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ courseId: 'course-1', favorite: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', favorite: true }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when favorite is not a boolean', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', courseId: 'course-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'favorite must be a boolean' });
  });

  it('returns 403 when caller is not an active member of the org', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);
    const res = await handler(baseReq(addBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('favorite=true on an inaccessible course returns 403 and does not insert', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access gate: not published/enabled for org
    const res = await handler(baseReq(addBody), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('c.is_published = TRUE');
    expect(sql).toContain('org_course_access');
    expect(params).toEqual(['org-1', 'course-1']);
    expect(mockQuery).not.toHaveBeenCalled(); // INSERT never runs
  });

  it('favorite=true happy path: gates access then upserts, returns { favorited: true }', async () => {
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // access gate passes
    mockQuery.mockResolvedValueOnce([]);              // INSERT ... ON CONFLICT DO NOTHING
    const res = await handler(baseReq(addBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ favorited: true });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO course_favorites (user_id, course_id)');
    expect(sql).toContain('ON CONFLICT (user_id, course_id) DO NOTHING');
    expect(params).toEqual(['p1', 'course-1']); // profile.id, never a client user id
  });

  it('favorite=false: deletes with no access gate, returns { favorited: false }', async () => {
    mockQuery.mockResolvedValueOnce([]); // DELETE
    const res = await handler(baseReq(removeBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ favorited: false });
    expect(mockQueryOne).not.toHaveBeenCalled(); // no access gate on remove
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM course_favorites WHERE user_id = $1 AND course_id = $2');
    expect(params).toEqual(['p1', 'course-1']);
  });
});
