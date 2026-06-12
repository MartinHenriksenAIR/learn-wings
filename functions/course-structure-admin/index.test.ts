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
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne, withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({
  getProfile: mockGetProfile,
  isActiveMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminOfAny: vi.fn(),
}));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

const adminProfile = { id: 'admin-1', is_platform_admin: true };
const nonAdminProfile = { id: 'user-1', is_platform_admin: false };

const validBody = { courseId: 'course-1' };

const fakeCourse = { id: 'course-1', title: 'Test Course', is_published: false };
const fakeModule1 = { id: 'mod-1', course_id: 'course-1', title: 'Module 1', sort_order: 0 };
const fakeModule2 = { id: 'mod-2', course_id: 'course-1', title: 'Module 2', sort_order: 1 };
const fakeLesson1 = { id: 'les-1', module_id: 'mod-1', title: 'Lesson 1', sort_order: 0 };
const fakeLesson2 = { id: 'les-2', module_id: 'mod-1', title: 'Lesson 2', sort_order: 1 };

describe('course-structure-admin', () => {
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
  });

  it('returns 400 when courseId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is empty string', async () => {
    const res = await handler(baseReq({ courseId: '' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 400 when courseId is not a string', async () => {
    const res = await handler(baseReq({ courseId: 123 }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'courseId is required' });
  });

  it('returns 200 {course: null, modules: []} when course not found — no further queries', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // course not found
    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ course: null, modules: [] });
    // Only the course queryOne should have been called; no module/lesson queries
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('happy path: returns course with modules and lessons grouped by module_id', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse); // course
    mockQuery
      .mockResolvedValueOnce([fakeModule1, fakeModule2]) // modules
      .mockResolvedValueOnce([fakeLesson1, fakeLesson2]); // all lessons for course

    const res = await handler(baseReq(validBody), {} as any);
    expect(res.status).toBe(200);

    const body = JSON.parse(res.body as string);
    expect(body.course).toEqual(fakeCourse);
    expect(body.modules).toHaveLength(2);

    // mod-1 has 2 lessons, mod-2 has 0
    const m1 = body.modules.find((m: any) => m.id === 'mod-1');
    const m2 = body.modules.find((m: any) => m.id === 'mod-2');
    expect(m1.lessons).toHaveLength(2);
    expect(m1.lessons[0]).toEqual(fakeLesson1);
    expect(m1.lessons[1]).toEqual(fakeLesson2);
    expect(m2.lessons).toHaveLength(0);
  });

  it('happy path: passes correct SQL and params for modules and lessons queries', async () => {
    mockQueryOne.mockResolvedValueOnce(fakeCourse);
    // Dispatch by SQL so the test is order-agnostic with respect to Promise.all parallelism
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('lessons') && sql.includes('JOIN course_modules')) return Promise.resolve([fakeLesson1]);
      return Promise.resolve([fakeModule1]); // course_modules query
    });

    await handler(baseReq(validBody), {} as any);

    const allCalls = mockQuery.mock.calls as [string, unknown[]][];

    // Modules query — order-agnostic lookup
    const modulesCall = allCalls.find(([sql]) => sql.includes('course_modules') && !sql.includes('lessons'));
    expect(modulesCall).toBeDefined();
    const [modulesSql, modulesParams] = modulesCall!;
    expect(modulesSql).toContain('course_modules');
    expect(modulesSql).toContain('ORDER BY sort_order');
    expect(modulesParams).toContain('course-1');

    // Lessons query — single query for all lessons via JOIN
    const lessonsCall = allCalls.find(([sql]) => sql.includes('lessons') && sql.includes('JOIN course_modules'));
    expect(lessonsCall).toBeDefined();
    const [lessonsSql, lessonsParams] = lessonsCall!;
    expect(lessonsSql).toContain('lessons');
    expect(lessonsSql).toContain('JOIN course_modules');
    expect(lessonsSql).toContain('ORDER BY');
    expect(lessonsParams).toContain('course-1');
  });

  it('returns 500 on db error propagating err.message', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db connection failed'));
    const res = await handler(baseReq(validBody), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
