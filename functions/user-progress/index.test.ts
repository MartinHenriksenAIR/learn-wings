import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockGetProfile, mockIsOrgAdmin } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(), MockAuthError,
    mockQuery: vi.fn(),
    mockGetProfile: vi.fn(), mockIsOrgAdmin: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: vi.fn(), withTransaction: vi.fn(), getDb: vi.fn() }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: vi.fn(), isOrgAdmin: mockIsOrgAdmin, isOrgAdminOfAny: vi.fn() }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

// Fixture: 1 enrollment, 2 modules (m1: video lesson l1 + quiz lesson l2; m2: empty),
// l1 completed, quiz q1 on l2 with 2 attempts (latest first).
const enrollmentRows = [{
  id: 'e1', course_id: 'c1', status: 'active', enrolled_at: '2026-01-01T00:00:00Z',
  completed_at: null, title: 'Course One', level: 'basic',
}];
const progressRows = [
  { lesson_id: 'l1', status: 'completed', completed_at: '2026-01-02T00:00:00Z' },
];
const attemptRows = [
  { id: 'a2', quiz_id: 'q1', score: 90, passed: true, started_at: '2026-01-04T00:00:00Z', finished_at: '2026-01-04T00:10:00Z' },
  { id: 'a1', quiz_id: 'q1', score: 40, passed: false, started_at: '2026-01-03T00:00:00Z', finished_at: '2026-01-03T00:10:00Z' },
];
const structureRows = [
  { module_id: 'm1', course_id: 'c1', module_title: 'Module One', module_sort_order: 0,
    lesson_id: 'l1', lesson_title: 'Lesson One', lesson_type: 'video', lesson_sort_order: 0 },
  { module_id: 'm1', course_id: 'c1', module_title: 'Module One', module_sort_order: 0,
    lesson_id: 'l2', lesson_title: 'Quiz Lesson', lesson_type: 'quiz', lesson_sort_order: 1 },
  { module_id: 'm2', course_id: 'c1', module_title: 'Module Two', module_sort_order: 1,
    lesson_id: null, lesson_title: null, lesson_type: null, lesson_sort_order: null },
];
const quizRows = [{ id: 'q1', lesson_id: 'l2' }];

function mockHappyPath() {
  mockQuery
    .mockResolvedValueOnce(enrollmentRows)  // 1: enrollments + courses
    .mockResolvedValueOnce(progressRows)    // 2: lesson_progress
    .mockResolvedValueOnce(attemptRows)     // 3: quiz_attempts
    .mockResolvedValueOnce(structureRows)   // 4: modules + lessons
    .mockResolvedValueOnce(quizRows);       // 5: quizzes
}

describe('user-progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsOrgAdmin.mockResolvedValue(false);
  });

  it('handles OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { get: () => 'https://ai-uddannelse.dk' } } as any;
    const res = await handler(req, {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({ userId: 'p2' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 400 when userId is missing', async () => {
    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
  });

  it('returns 403 when caller is neither platform admin nor org admin (self-access excluded by design)', async () => {
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p1' }), {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
  });

  it('returns {courses: []} when the user has no enrollments, without further queries', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce([]);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body as string)).toEqual({ courses: [] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('happy path: assembles the full aggregate', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockHappyPath();
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    const { courses } = JSON.parse(res.body as string);
    expect(courses).toHaveLength(1);
    const c = courses[0];
    expect(c).toMatchObject({
      enrollmentId: 'e1', courseId: 'c1', courseTitle: 'Course One', courseLevel: 'basic',
      enrollmentStatus: 'active', enrolledAt: '2026-01-01T00:00:00Z', completedAt: null,
      totalLessons: 2, completedLessons: 1,
    });
    expect(c.modules).toHaveLength(2);
    expect(c.modules[0].lessons).toHaveLength(2);
    expect(c.modules[1].lessons).toHaveLength(0);
    // l1: completed via progress row, no quiz → quiz keys omitted
    expect(c.modules[0].lessons[0]).toEqual({
      id: 'l1', title: 'Lesson One', lessonType: 'video', sortOrder: 0,
      status: 'completed', completedAt: '2026-01-02T00:00:00Z',
    });
    // l2: no progress row → not_started; latest attempt (a2) attached
    expect(c.modules[0].lessons[1]).toEqual({
      id: 'l2', title: 'Quiz Lesson', lessonType: 'quiz', sortOrder: 1,
      status: 'not_started', completedAt: null,
      quizId: 'q1', latestQuizScore: 90, latestQuizPassed: true,
    });
    // attempts: both, lessonTitle resolved, order preserved (latest first)
    expect(c.quizAttempts).toEqual([
      { id: 'a2', quizId: 'q1', lessonTitle: 'Quiz Lesson', score: 90, passed: true,
        startedAt: '2026-01-04T00:00:00Z', finishedAt: '2026-01-04T00:10:00Z' },
      { id: 'a1', quizId: 'q1', lessonTitle: 'Quiz Lesson', score: 40, passed: false,
        startedAt: '2026-01-03T00:00:00Z', finishedAt: '2026-01-03T00:10:00Z' },
    ]);
  });

  it('skips the quizzes query when the structure has no lessons', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce(enrollmentRows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([structureRows[2]]); // only the empty module
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(4); // quizzes query skipped
    const { courses } = JSON.parse(res.body as string);
    expect(courses[0].modules[0].lessons).toEqual([]);
    expect(courses[0].quizAttempts).toEqual([]);
  });

  it('org admin: enrollment query filters to published, org-accessible courses (RLS parity)', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockHappyPath();
    await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_published');
    expect(sql).toContain('org_course_access');
    expect(params).toEqual(['org-1', 'p2']);
  });

  it('platform admin: enrollment query has NO visibility filter', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockHappyPath();
    await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(mockIsOrgAdmin).not.toHaveBeenCalled();
    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('is_published');
  });

  it('returns 500 on db error', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'connection refused' });
  });
});
