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
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const baseReq = (body: unknown = {}) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const fakeCourses = [
  { id: 'c1', title: 'Course 1', is_published: true },
  { id: 'c2', title: 'Course 2', is_published: false },
];
const fakeAccessRecords = [
  { id: 'a1', org_id: 'org-1', course_id: 'c1', access: 'enabled' },
];

describe('courses-admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue(adminProfile);
    mockQuery.mockResolvedValue([]);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 403 for non-platform-admin', async () => {
    mockGetProfile.mockResolvedValueOnce(nonAdminProfile);
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('happy path: returns courses and accessRecords', async () => {
    // Dispatch by SQL so the test is order-agnostic with respect to Promise.all parallelism
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM courses')) return Promise.resolve(fakeCourses);
      if (sql.includes('FROM org_course_access')) return Promise.resolve(fakeAccessRecords);
      return Promise.resolve([]);
    });
    const res = await handler(baseReq(), {} as any);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body).toEqual({ courses: fakeCourses, accessRecords: fakeAccessRecords });
    // Verify both SQL queries were made (order-agnostic)
    const allSqls = mockQuery.mock.calls.map(([sql]: [string]) => sql);
    expect(allSqls.some((s) => s.includes('FROM courses') && s.includes('ORDER BY created_at DESC'))).toBe(true);
    expect(allSqls.some((s) => s.includes('FROM org_course_access'))).toBe(true);
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
