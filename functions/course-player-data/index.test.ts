import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));

import handler from './index';

const baseReq = {
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => ({ courseId: 'course-uuid', orgId: 'org-uuid' }),
};

describe('course-player-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'learner-uuid', tid: 'tid-1', email: 'learner@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
  });

  it('returns course, modules with lessons, progressMap, and review', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    const modules = [{ id: 'mod-1', title: 'Module 1', sort_order: 1 }];
    const lessons = [{ id: 'lesson-1', title: 'Lesson 1', sort_order: 1 }];
    const progress = [{ lesson_id: 'lesson-1', status: 'completed', completed_at: '2026-05-01T00:00:00Z' }];
    const review = { id: 'rev-1', rating: 5, comment: 'Great!' };

    mockQueryOne.mockResolvedValueOnce(course);       // course lookup
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // access check
    mockQuery.mockResolvedValueOnce(modules);         // course_modules
    mockQuery.mockResolvedValueOnce(lessons);         // lessons for mod-1
    mockQuery.mockResolvedValueOnce(progress);        // lesson_progress
    mockQueryOne.mockResolvedValueOnce(review);       // course_reviews

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.course.id).toBe('course-uuid');
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].lessons).toHaveLength(1);
    expect(body.progressMap['lesson-1'].status).toBe('completed');
    expect(body.review.rating).toBe(5);

    // SECURITY PIN: lesson_progress must use profile.id ('p1'), not raw oid
    // mockQuery call order: 0=modules, 1=lessons for mod-1, 2=lesson_progress
    const [progressSql, progressParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(progressSql).toContain('lesson_progress');
    expect(progressParams).toEqual(['p1', 'org-uuid']);

    // SECURITY PIN: course_reviews must use profile.id ('p1'), not raw oid
    // mockQueryOne call order: 0=course, 1=access check, 2=course_reviews
    const reviewCall = mockQueryOne.mock.calls[2] as [string, unknown[]];
    expect(reviewCall[0]).toContain('course_reviews');
    expect(reviewCall[1]).toEqual(['p1', 'org-uuid', 'course-uuid']);
  });

  it('returns 404 when course does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // course not found

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks org access to the course (parity with quiz-by-lesson)', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);       // course lookup
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access check fails

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });

    // No course content (modules/lessons/progress/reviews) should be fetched once access is denied
    expect(mockQuery).not.toHaveBeenCalled();

    // Access EXISTS check must be keyed on profile.id + courseId and gate on enablement + publication
    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).toContain('org_course_access');
    expect(accessSql).toContain('org_memberships');
    expect(accessSql).toContain('is_published');
    expect(accessParams).toEqual(['p1', 'course-uuid']);
  });

  it('returns 403 for a non-admin opening an unpublished course (gate enforces publication)', async () => {
    // Course row exists (404 check passes) but is_published = false. The access EXISTS check
    // gates on is_published = TRUE, so it returns false for a non-admin learner.
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: false };
    mockQueryOne.mockResolvedValueOnce(course);        // course lookup
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // access check fails (unpublished)

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQuery).not.toHaveBeenCalled();

    // Pin the security-critical gating predicates BY VALUE. A regression that opens the gate
    // (drops the publication / enablement / active-membership clause) must fail here rather than
    // slip past a loose table-name substring check.
    const [accessSql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain("oca.access = 'enabled'");
    expect(accessSql).toContain("om.status = 'active'");
  });

  it('skips the access check for platform admins', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const course = { id: 'course-uuid', title: 'AI Basics', is_published: false };
    mockQueryOne.mockResolvedValueOnce(course); // course lookup
    mockQuery.mockResolvedValueOnce([]);        // no modules
    mockQuery.mockResolvedValueOnce([]);        // no progress
    mockQueryOne.mockResolvedValueOnce(null);   // no review

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);

    // Only course lookup + review queryOne — no access EXISTS check ran
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    for (const [sql] of mockQueryOne.mock.calls as [string][]) {
      expect(sql).not.toContain('org_course_access');
    }
  });

  it('returns null review when user has not reviewed the course', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);       // course
    mockQueryOne.mockResolvedValueOnce({ ok: true }); // access check
    mockQuery.mockResolvedValueOnce([]);              // no modules
    mockQuery.mockResolvedValueOnce([]);              // no progress
    mockQueryOne.mockResolvedValueOnce(null);         // no review

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.review).toBeNull();
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });
});
