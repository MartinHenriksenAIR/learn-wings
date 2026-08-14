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

const noEnrollmentInsert = () =>
  expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO enrollments/i.test(sql as string)),
    'learner-course-detail must be READ-ONLY — reading about a course must never enroll (unlike course-player-data)')
    .toBeUndefined();

describe('learner-course-detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'learner-uuid', tid: 'tid-1', email: 'learner@test.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockResolveVisibility.mockResolvedValue({ isIndividual: false, language: 'da' });
    mockIsActiveMember.mockResolvedValue(true);
  });

  it('returns course, module outline (title + lesson_count + lesson names), and the caller enrollment — and NEVER enrolls', async () => {
    const course = { id: 'course-uuid', title: 'AI Basics', description: 'Learn AI', level: 'basic', category_id: 'cat-1' };
    const modules = [
      { id: 'mod-1', title: 'Module 1', sort_order: 1, lesson_count: 2 },
      { id: 'mod-2', title: 'Module 2', sort_order: 2, lesson_count: 0 },
    ];
    const lessons = [
      { id: 'les-1', module_id: 'mod-1', title: 'Intro', sort_order: 1 },
      { id: 'les-2', module_id: 'mod-1', title: 'Deep dive', sort_order: 2 },
    ];

    mockQueryOne.mockResolvedValueOnce(course);          // course
    mockQueryOne.mockResolvedValueOnce({ ok: true });     // access
    mockQuery.mockResolvedValueOnce(modules);             // module outline
    mockQuery.mockResolvedValueOnce(lessons);             // lesson names for all modules
    mockQueryOne.mockResolvedValueOnce({ status: 'enrolled' }); // enrollment

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.course.id).toBe('course-uuid');
    expect(body.modules).toHaveLength(2);
    expect(body.enrollment.status).toBe('enrolled');

    expect(body.modules[0].lesson_count).toBe(2);
    expect(body.modules[0].lessons).toEqual([
      { id: 'les-1', title: 'Intro', sort_order: 1 },
      { id: 'les-2', title: 'Deep dive', sort_order: 2 },
    ]);
    expect(body.modules[0].lessons[0]).not.toHaveProperty('content_text');
    expect(body.modules[0].lessons[0]).not.toHaveProperty('module_id');
    expect(body.modules[1].lesson_count).toBe(0);
    expect(body.modules[1].lessons).toEqual([]);

    const [modulesSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(modulesSql).toContain('LEFT JOIN lessons');
    expect(modulesSql).toContain('lesson_count');
    expect(modulesSql).toContain('ORDER BY cm.sort_order, cm.id');

    const [lessonsSql, lessonsParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(lessonsSql).toContain('FROM lessons');
    expect(lessonsSql).toContain('module_id = ANY($1)');
    expect(lessonsSql).toContain('ORDER BY sort_order, id');
    expect(lessonsSql).not.toContain('content_text');
    expect(lessonsParams).toEqual([['mod-1', 'mod-2']]);

    const enrollCall = mockQueryOne.mock.calls[2] as [string, unknown[]];
    expect(enrollCall[0]).toContain('FROM enrollments');
    expect(enrollCall[1]).toEqual(['p1', 'org-uuid', 'course-uuid']);

    noEnrollmentInsert();
  });

  it('returns enrollment: null for a course the caller has not started', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A' }); // course
    mockQueryOne.mockResolvedValueOnce({ ok: true });                       // access
    mockQuery.mockResolvedValueOnce([]);                                    // modules
    mockQueryOne.mockResolvedValueOnce(null);                               // enrollment

    const res = await handler(baseReq as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.enrollment).toBeNull();
    noEnrollmentInsert();
  });

  it('individual org: grants access via language gate, bypassing org_course_access — still read-only (#354)', async () => {
    mockResolveVisibility.mockResolvedValueOnce({ isIndividual: true, language: 'en' });
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A', language: 'en' }); // course
    mockIsActiveMember.mockResolvedValueOnce(true);                                          // requireActiveMember
    mockQueryOne.mockResolvedValueOnce({ ok: true });                                        // individual access check
    mockQuery.mockResolvedValueOnce([]);                                                     // modules
    mockQueryOne.mockResolvedValueOnce(null);                                                // enrollment

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);

    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).not.toContain('org_course_access');
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain('c.language = $3');
    expect(accessParams).toEqual(['p1', 'course-uuid', 'en', 'org-uuid']);
    noEnrollmentInsert();
  });

  it('individual org: denies access (403) when the caller is not an active member (#354)', async () => {
    mockResolveVisibility.mockResolvedValueOnce({ isIndividual: true, language: 'en' });
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A', language: 'en' }); // course
    mockIsActiveMember.mockResolvedValueOnce(false);                                         // requireActiveMember → 403

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(403);
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-uuid');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('individual org: denies access (403) when the language gate fails — published, wrong language, not enrolled (#354)', async () => {
    mockResolveVisibility.mockResolvedValueOnce({ isIndividual: true, language: 'en' });
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A', language: 'da' }); // course (wrong lang)
    mockIsActiveMember.mockResolvedValueOnce(true);   // active member
    mockQueryOne.mockResolvedValueOnce({ ok: false }); // language gate fails

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQuery).not.toHaveBeenCalled();

    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).not.toContain('org_course_access');
    expect(accessSql).toContain('c.language = $3');
    expect(accessParams).toEqual(['p1', 'course-uuid', 'en', 'org-uuid']);
  });

  it('returns 404 when the course does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(404);
  });

  it('returns 403 (parity with course-player-data) when the learner lacks org access', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A', is_published: true }); // course
    mockQueryOne.mockResolvedValueOnce({ ok: false });                                          // access denied

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Course access denied' });
    expect(mockQuery).not.toHaveBeenCalled();

    const [accessSql, accessParams] = mockQueryOne.mock.calls[1] as [string, unknown[]];
    expect(accessSql).toContain('is_published = TRUE');
    expect(accessSql).toContain("oca.access = 'enabled'");
    expect(accessSql).toContain("om.status = 'active'");
    expect(accessParams).toEqual(['p1', 'course-uuid']);
  });

  it('skips the access check for platform admins', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQueryOne.mockResolvedValueOnce({ id: 'course-uuid', title: 'A', is_published: false }); // course
    mockQuery.mockResolvedValueOnce([]);                                                          // modules
    mockQueryOne.mockResolvedValueOnce(null);                                                     // enrollment

    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(200);
    expect(mockQueryOne).toHaveBeenCalledTimes(2);
    for (const [sql] of mockQueryOne.mock.calls as [string][]) {
      expect(sql).not.toContain('org_course_access');
    }
    noEnrollmentInsert();
  });

  it('returns 400 when courseId is missing', async () => {
    const req = { ...baseReq, json: async () => ({ orgId: 'org-uuid' }) };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(400);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const req = { ...baseReq, json: async () => ({ courseId: 'course-uuid' }) };
    const res = await handler(req as any, {} as any);
    expect(res.status).toBe(400);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 401 when getProfile returns null', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const res = await handler(baseReq as any, {} as any);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });
});
