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
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
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

  it('multi-course: structure, attempts and counts stay isolated per course', async () => {
    mockIsOrgAdmin.mockResolvedValueOnce(true);
    const twoEnrollments = [
      ...enrollmentRows,
      { id: 'e2', course_id: 'c2', status: 'completed', enrolled_at: '2026-01-05T00:00:00Z',
        completed_at: '2026-01-06T00:00:00Z', title: 'Course Two', level: 'advanced' },
    ];
    const twoCourseStructure = [
      ...structureRows,
      { module_id: 'm3', course_id: 'c2', module_title: 'C2 Module', module_sort_order: 0,
        lesson_id: 'l3', lesson_title: 'C2 Lesson', lesson_type: 'quiz', lesson_sort_order: 0 },
    ];
    const twoCourseQuizzes = [...quizRows, { id: 'q2', lesson_id: 'l3' }];
    const twoCourseAttempts = [
      ...attemptRows,
      { id: 'a3', quiz_id: 'q2', score: 70, passed: true, started_at: '2026-01-05T12:00:00Z', finished_at: '2026-01-05T12:10:00Z' },
    ];
    mockQuery
      .mockResolvedValueOnce(twoEnrollments)
      .mockResolvedValueOnce(progressRows)
      .mockResolvedValueOnce(twoCourseAttempts)
      .mockResolvedValueOnce(twoCourseStructure)
      .mockResolvedValueOnce(twoCourseQuizzes);
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), {} as any);
    expect(res.status).toBe(200);
    const { courses } = JSON.parse(res.body as string);
    expect(courses).toHaveLength(2);
    const [c1, c2] = courses;
    // c1 unchanged by c2's data: same modules, attempts only for q1
    expect(c1.modules.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
    expect(c1.quizAttempts.map((a: { id: string }) => a.id)).toEqual(['a2', 'a1']);
    expect(c1.totalLessons).toBe(2);
    // c2 gets only its own module, lesson and attempt
    expect(c2.modules.map((m: { id: string }) => m.id)).toEqual(['m3']);
    expect(c2.modules[0].lessons[0]).toEqual({
      id: 'l3', title: 'C2 Lesson', lessonType: 'quiz', sortOrder: 0,
      status: 'not_started', completedAt: null,
      quizId: 'q2', latestQuizScore: 70, latestQuizPassed: true,
    });
    expect(c2.quizAttempts.map((a: { id: string }) => a.id)).toEqual(['a3']);
    expect(c2.totalLessons).toBe(1);
    expect(c2.completedLessons).toBe(0);
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
    const res = await handler(baseReq({ orgId: 'org-1', userId: 'p2' }), { error: vi.fn() } as any);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });

  // ── All-orgs aggregate (orgId 'all') — platform admins only ──────────────
  describe('all-orgs aggregate (orgId "all")', () => {
    it('returns 403 for a non-platform-admin (org admins stay isolated)', async () => {
      mockIsOrgAdmin.mockResolvedValue(true);
      const res = await handler(baseReq({ orgId: 'all', userId: 'p2' }), {} as any);
      expect(res.status).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('still 400s when userId is missing', async () => {
      mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
      const res = await handler(baseReq({ orgId: 'all' }), {} as any);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'userId is required' });
    });

    it('platform admin: aggregates the user across all orgs, deduped by course, no org/visibility filter', async () => {
      mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
      mockHappyPath();
      const res = await handler(baseReq({ orgId: 'all', userId: 'p2' }), {} as any);

      expect(res.status).toBe(200);
      const { courses } = JSON.parse(res.body as string);
      expect(courses).toHaveLength(1);
      expect(mockIsOrgAdmin).not.toHaveBeenCalled();

      // enrollment query: one row per course across orgs, no org bind, no publish filter
      const [enrSql, enrParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(enrSql).toContain('DISTINCT ON (e.course_id)');
      expect(enrSql).not.toContain('is_published');
      expect(enrSql).not.toContain('e.org_id');
      expect(enrParams).toEqual(['p2']); // userId only — no orgId

      // progress + attempts filter by user only (span every org)
      const [progSql, progParams] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(progSql).not.toContain('org_id');
      expect(progParams).toEqual(['p2']);
      const [attSql, attParams] = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(attSql).not.toContain('org_id');
      expect(attParams).toEqual(['p2']);
    });
  });
});
