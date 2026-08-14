import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember, mockResolveVisibility } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
    mockResolveVisibility: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn() }));
vi.mock('../shared/course-visibility', () => ({ resolveVisibilityContext: mockResolveVisibility }));

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
    mockResolveVisibility.mockResolvedValue({ isIndividual: false, language: 'da' });
    mockIsActiveMember.mockResolvedValue(true);
  });

  it('returns course, modules with lessons, progressMap, and review', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    const modules = [{ id: 'mod-1', title: 'Module 1', sort_order: 1 }];
    const lessons = [{ id: 'lesson-1', title: 'Lesson 1', sort_order: 1 }];
    const progress = [{ lesson_id: 'lesson-1', status: 'completed', completed_at: '2026-05-01T00:00:00Z' }];
    const review = { id: 'rev-1', rating: 5, comment: 'Great!' };

    mockQueryOne.mockResolvedValueOnce(course);
    mockQueryOne.mockResolvedValueOnce({ ok: true });
    mockQuery.mockResolvedValueOnce(modules);
    mockQuery.mockResolvedValueOnce(lessons);
    mockQuery.mockResolvedValueOnce(progress);
    mockQueryOne.mockResolvedValueOnce(review);

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.course.id).toBe('course-uuid');
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].lessons).toHaveLength(1);
    expect(body.progressMap['lesson-1'].status).toBe('completed');
    expect(body.review.rating).toBe(5);

    const [modulesSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(modulesSql).toContain('ORDER BY sort_order, id');
    const [lessonsSql] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(lessonsSql).toContain('ORDER BY sort_order, id');

    const [progressSql, progressParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(progressSql).toContain('lesson_progress');
    expect(progressParams).toEqual(['p1', 'org-uuid']);

    const reviewCall = mockQueryOne.mock.calls[2] as [string, unknown[]];
    expect(reviewCall[0]).toContain('course_reviews');
    expect(reviewCall[1]).toEqual(['p1', 'org-uuid', 'course-uuid']);
  });

  it('auto-creates the enrollment on access, self-gated for org isolation (implicit enrollment #357)', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);       // course
    mockQueryOne.mockResolvedValueOnce({ ok: true });  // access
    mockQuery.mockResolvedValueOnce([{ id: 'mod-1', title: 'Module 1', sort_order: 1 }]); // modules
    mockQuery.mockResolvedValueOnce([]);               // lessons for mod-1
    mockQuery.mockResolvedValueOnce([]);               // lesson_progress
    mockQueryOne.mockResolvedValueOnce(null);          // review
    mockQuery.mockResolvedValueOnce([]);               // enrollment upsert

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO enrollments/i.test(sql as string));
    expect(insertCall, 'course-player-data must upsert an enrollment on access').toBeDefined();
    const [insertSql, insertParams] = insertCall as [string, unknown[]];
    expect(insertSql).toContain('org_memberships');
    expect(insertSql).toContain("om.status = 'active'");
    expect(insertSql).toContain("oca.access = 'enabled'");
    expect(insertSql).toContain('is_published = TRUE');
    expect(insertSql).toContain('ON CONFLICT (org_id, user_id, course_id) DO NOTHING');
    expect(insertParams).toEqual(['org-uuid', 'p1', 'course-uuid']);
  });

  it('individual org: grants access + implicit-enrolls with no org_course_access (#354)', async () => {
    mockResolveVisibility.mockResolvedValueOnce({ isIndividual: true, language: 'en' });
    const course = { id: 'course-uuid', title: 'A', language: 'en', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);        // course
    mockIsActiveMember.mockResolvedValueOnce(true);    // requireActiveMember
    mockQueryOne.mockResolvedValueOnce({ ok: true });  // individual access check
    mockQuery.mockResolvedValue([]);                   // modules / progress / enrollment INSERT
    mockQueryOne.mockResolvedValueOnce(null);          // review

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).not.toContain('org_course_access');
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain('c.language = $3');
    expect(accessParams).toEqual(['p1', 'course-uuid', 'en', 'org-uuid']);

    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO enrollments/i.test(sql as string));
    expect(insertCall, 'individual open must upsert an enrollment').toBeDefined();
    const [insertSql, insertParams] = insertCall as [string, unknown[]];
    expect(insertSql).not.toContain('org_course_access');
    expect(insertSql).toContain('org_memberships');
    expect(insertSql).toContain("om.status = 'active'");
    expect(insertSql).toContain('is_published = TRUE');
    expect(insertSql).toContain('ON CONFLICT (org_id, user_id, course_id) DO NOTHING');
    expect(insertParams).toEqual(['org-uuid', 'p1', 'course-uuid']);
  });

  it('individual org: denies access (403) when caller is not an active member (#354)', async () => {
    mockResolveVisibility.mockResolvedValueOnce({ isIndividual: true, language: 'en' });
    const course = { id: 'course-uuid', title: 'A', language: 'en', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);        // course
    mockIsActiveMember.mockResolvedValueOnce(false);   // requireActiveMember → 403

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(403);
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-uuid');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when course does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks org access to the course (parity with quiz-by-lesson)', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);
    mockQueryOne.mockResolvedValueOnce({ ok: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQuery).not.toHaveBeenCalled();

    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).toContain('org_course_access');
    expect(accessSql).toContain('org_memberships');
    expect(accessSql).toContain('is_published');
    expect(accessParams).toEqual(['p1', 'course-uuid']);
  });

  it('returns 403 for a non-admin opening an unpublished course (gate enforces publication)', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: false };
    mockQueryOne.mockResolvedValueOnce(course);
    mockQueryOne.mockResolvedValueOnce({ ok: false });

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQuery).not.toHaveBeenCalled();

    const [accessSql] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain("oca.access = 'enabled'");
    expect(accessSql).toContain("om.status = 'active'");
  });

  it('skips the access check for platform admins', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });

    const course = { id: 'course-uuid', title: 'AI Basics', is_published: false };
    mockQueryOne.mockResolvedValueOnce(course);
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce(null);

    const res = await handler(baseReq as any, {} as any);

    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    for (const [sql] of mockQueryOne.mock.calls as [string][]) {
      expect(sql).not.toContain('org_course_access');
    }
  });

  it('returns null review when user has not reviewed the course', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', is_published: true };
    mockQueryOne.mockResolvedValueOnce(course);
    mockQueryOne.mockResolvedValueOnce({ ok: true });
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce(null);

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
