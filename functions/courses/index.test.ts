import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(), mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  // 1. 401 invalid token
  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  // 2. 401 profile not provisioned
  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  // 3. 400 when courseIds is not an array
  it('returns 400 when courseIds is not an array', async () => {
    const res = await handler(baseReq({ courseIds: 'x' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseIds must be an array of strings' });
  });

  // 3b. 400 when courseIds contains non-string elements
  it('returns 400 when courseIds contains non-string elements', async () => {
    const res = await handler(baseReq({ courseIds: [1] }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseIds must be an array of strings' });
  });

  // 4. Platform admin, no filter — no JOIN, no WHERE, explicit columns, no SELECT *
  it('returns all courses for platform admin without filter', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'c1', title: 'Intro', description: 'Desc' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[] | undefined];
    expect(sql).not.toContain('JOIN');
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('title');
    expect(sql).toContain('description');
    expect(sql).not.toContain('SELECT *');
    expect(params ?? []).toEqual([]);
  });

  // 5. Platform admin with courseIds → SQL contains ANY($1::uuid[]), params [['c1','c2']]
  it('returns filtered courses for platform admin with courseIds', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    const rows = [{ id: 'c1', title: 'Course 1' }, { id: 'c2', title: 'Course 2' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ courseIds: ['c1', 'c2'] }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toHaveLength(2);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ANY($1::uuid[])');
    expect(params).toEqual([['c1', 'c2']]);
  });

  // 6. Member tier, no filter → SQL contains org_course_access, access = 'enabled', om.status = 'active', c.is_published = TRUE, params ['p1']
  it('returns published org-accessible courses for member without filter', async () => {
    const rows = [{ id: 'c1', title: 'Published Course' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('org_course_access');
    expect(sql).toContain("access = 'enabled'");
    expect(sql).toContain("om.status = 'active'");
    expect(sql).toContain('c.is_published = TRUE');
    expect(params).toEqual(['p1']);
  });

  // 7. Member tier with courseIds → SQL contains ANY($2::uuid[]), params ['p1', ['c1']]
  it('returns filtered published org-accessible courses for member with courseIds', async () => {
    const rows = [{ id: 'c1', title: 'Published Course' }];
    mockQuery.mockResolvedValueOnce(rows);

    const res = await handler(baseReq({ courseIds: ['c1'] }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ANY($2::uuid[])');
    expect(params).toEqual(['p1', ['c1']]);
  });

  // 8. 500 on db error
  it('returns 500 on db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({}), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
