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
// isActiveMember backs the factory's requireActiveMember (used by the individual branch).
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember, isOrgAdmin: vi.fn() }));
// resolveVisibilityContext is mocked (not left to hit the mocked queryOne) so it consumes
// no query slot — keeping every existing order-sensitive queryOne sequence intact.
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
    // Default: standard (non-individual) tier — keeps every existing test on the org_course_access path.
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

    // Deterministic ordering (issue #46): id tie-breaker on equal sort_order ranks
    const [modulesSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(modulesSql).toContain('ORDER BY sort_order, id');
    const [lessonsSql] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(lessonsSql).toContain('ORDER BY sort_order, id');

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
    // SECURITY PIN: the upsert only writes for an active member of THIS org, with the
    // course enabled + published — never an org the client merely named. Pinned by value
    // so a regression that drops a gating clause fails here.
    expect(insertSql).toContain('org_memberships');
    expect(insertSql).toContain("om.status = 'active'");
    expect(insertSql).toContain("oca.access = 'enabled'");
    expect(insertSql).toContain('is_published = TRUE');
    expect(insertSql).toContain('ON CONFLICT (org_id, user_id, course_id) DO NOTHING');
    // profile.id ('p1'), not the raw token oid, and the passed org — org-scoped write.
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

    // Individual access check bypasses org_course_access and gates on the caller's language.
    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).not.toContain('org_course_access');
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain('c.language = $3');
    expect(accessParams).toEqual(['p1', 'course-uuid', 'en', 'org-uuid']);

    // The implicit-enroll INSERT for individuals drops the org_course_access EXISTS,
    // but keeps membership + publication + ON CONFLICT DO NOTHING.
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
    // The individual gate runs through requireActiveMember, and no further work happens.
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
    mockQueryOne.mockResolvedValueOnce(course);
    mockQueryOne.mockResolvedValueOnce({ ok: false });

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
