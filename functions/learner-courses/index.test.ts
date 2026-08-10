import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne, mockGetProfile, mockIsActiveMember } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return {
    mockAuthenticate: vi.fn(),
    MockAuthError,
    mockQuery: vi.fn(),
    mockQueryOne: vi.fn(),
    mockGetProfile: vi.fn(),
    mockIsActiveMember: vi.fn(),
  };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile, isActiveMember: mockIsActiveMember }));

import handler from './index';

const baseReq = (body: unknown) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
}) as any;

describe('learner-courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'oid-1', tid: 'tid-1', email: 'u@x.com' });
    mockGetProfile.mockResolvedValue({ id: 'p1', is_platform_admin: false });
    mockIsActiveMember.mockResolvedValue(false);
    // resolveVisibilityContext runs before the courses query — default a standard org
    // so the existing (curated-catalogue) path is exercised unless a test overrides it.
    mockQueryOne.mockResolvedValue({ kind: 'standard', language: 'da' });
  });

  it('returns 401 when bearer token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
  });

  it('returns 401 when profile is not provisioned', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Profile not found' });
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(baseReq({}), {} as any);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'orgId is required' });
  });

  it('returns 403 for non-member and calls isActiveMember with correct args', async () => {
    mockIsActiveMember.mockResolvedValueOnce(false);

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(403);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Forbidden' });
    expect(mockIsActiveMember).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('returns 200 with courses and enrollments for a member', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);

    const courseRows = [
      {
        id: 'c1', title: 'Alpha Course', description: 'Desc 1', level: 'beginner',
        is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-01',
      },
      {
        id: 'c2', title: 'Beta Course', description: 'Desc 2', level: 'intermediate',
        is_published: true, thumbnail_url: null, created_by_user_id: 'p2', created_at: '2024-01-02',
      },
    ];

    const enrollmentRows = [
      {
        id: 'e1', org_id: 'org-1', user_id: 'p1', course_id: 'c1',
        status: 'enrolled', enrolled_at: '2024-01-10', completed_at: null,
      },
    ];

    mockQuery
      .mockResolvedValueOnce(courseRows)                       // courses query
      .mockResolvedValueOnce(enrollmentRows)                   // enrollments query
      .mockResolvedValueOnce([{ course_id: 'c1', total: 4 }])  // totals query
      .mockResolvedValueOnce([{ course_id: 'c1', completed: 1 }]); // completed query

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.courses).toEqual(courseRows);
    expect(body.enrollments).toEqual(enrollmentRows);
    // Progress is keyed by enrolled courseId with the lesson totals/completed counts.
    expect(body.progress).toEqual({ c1: { total: 4, completed: 1 } });

    // Assert courses SQL — access = 'enabled', is_published = TRUE, language filter, no SELECT *
    const [coursesSql, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesSql).toContain("access = 'enabled'");
    expect(coursesSql).toContain('c.is_published = TRUE');
    expect(coursesSql).toContain('c.language');
    expect(coursesSql).toContain('c.language = $2');
    // Language relaxation: an already-enrolled course is always shown regardless of language
    expect(coursesSql).toContain('FROM enrollments e');
    expect(coursesSql).not.toContain('SELECT *');
    // No language sent — defaults to 'da'; profile.id travels as $3 for the enrolled-union
    expect(coursesParams).toEqual(['org-1', 'da', 'p1']);

    // Assert enrollments SQL — user_id = $1, no SELECT *, params ['p1', 'org-1']
    const [enrollSql, enrollParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(enrollSql).toContain('user_id = $1');
    expect(enrollSql).not.toContain('SELECT *');
    // last_accessed_at drives the catalog's recency ordering of enrolled courses (#339).
    expect(enrollSql).toContain('last_accessed_at');
    expect(enrollParams).toEqual(['p1', 'org-1']);
  });

  it('exposes c.category_id in the courses SELECT and passes it through (set + null)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);

    const courseRows = [
      {
        id: 'c1', title: 'Categorized', description: null, level: 'basic', language: 'da',
        is_published: true, thumbnail_url: null, category_id: 'cat-1', created_by_user_id: 'p2', created_at: '2024-01-01',
      },
      {
        id: 'c2', title: 'Uncategorized', description: null, level: 'basic', language: 'da',
        is_published: true, thumbnail_url: null, category_id: null, created_by_user_id: 'p2', created_at: '2024-01-02',
      },
    ];

    mockQuery
      .mockResolvedValueOnce(courseRows) // courses query
      .mockResolvedValueOnce([]);        // enrollments query (empty)

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const [coursesSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesSql).toContain('c.category_id');

    const body = JSON.parse(res.body as string);
    expect(body.courses).toEqual(courseRows);
    expect(body.courses[0].category_id).toBe('cat-1');
    expect(body.courses[1].category_id).toBeNull();
  });

  it('returns progress: {} and runs no count queries when the caller has no enrollments', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query (empty)

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.progress).toEqual({});
    // Only the courses + enrollments queries ran — no totals/completed count queries.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('computes progress per enrolled course, zero-filling courses with no lessons/progress', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);

    const enrollmentRows = [
      { id: 'e1', org_id: 'org-1', user_id: 'p1', course_id: 'c1', status: 'enrolled', enrolled_at: '2024-01-10', completed_at: null },
      { id: 'e2', org_id: 'org-1', user_id: 'p1', course_id: 'c2', status: 'completed', enrolled_at: '2024-01-11', completed_at: '2024-02-01' },
    ];

    mockQuery
      .mockResolvedValueOnce([])                               // courses query
      .mockResolvedValueOnce(enrollmentRows)                   // enrollments query
      .mockResolvedValueOnce([{ course_id: 'c1', total: 5 }])  // totals: only c1 has lessons
      .mockResolvedValueOnce([{ course_id: 'c1', completed: 3 }]); // completed: only c1 has progress

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    // c2 is zero-filled to { total: 0, completed: 0 }.
    expect(body.progress).toEqual({
      c1: { total: 5, completed: 3 },
      c2: { total: 0, completed: 0 },
    });

    // Count queries mirror learner-dashboard's batched SQL and params. Assert each
    // query's distinguishing structure (aggregate, tables, joins, GROUP BY) so an
    // accidental drift from the dashboard mirror is caught, not just the ANY(...) param.
    const [totalsSql, totalsParams] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(totalsSql).toContain('COUNT(l.id)::int AS total');
    expect(totalsSql).toContain('FROM course_modules cm');
    expect(totalsSql).toContain('JOIN lessons l ON l.module_id = cm.id');
    expect(totalsSql).toContain('cm.course_id = ANY($1::uuid[])');
    expect(totalsSql).toContain('GROUP BY cm.course_id');
    expect(totalsParams).toEqual([['c1', 'c2']]);

    const [completedSql, completedParams] = mockQuery.mock.calls[3] as [string, unknown[]];
    expect(completedSql).toContain('COUNT(*)::int AS completed');
    expect(completedSql).toContain('FROM lesson_progress lp');
    expect(completedSql).toContain('JOIN lessons l ON l.id = lp.lesson_id');
    expect(completedSql).toContain('JOIN course_modules cm ON cm.id = l.module_id');
    expect(completedSql).toContain("lp.status = 'completed'");
    expect(completedSql).toContain('cm.course_id = ANY($3::uuid[])');
    expect(completedSql).toContain('GROUP BY cm.course_id');
    expect(completedParams).toEqual(['p1', 'org-1', ['c1', 'c2']]);
  });

  it('passes language "en" through to the courses query param', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1', language: 'en' }), {} as any);

    expect(res.status).toBe(200);
    const [coursesSql, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesSql).toContain('c.language = $2');
    expect(coursesParams).toEqual(['org-1', 'en', 'p1']);
  });

  it('always includes the enrolled-courses EXISTS clause with profile.id as $3', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1', language: 'en' }), {} as any);

    expect(res.status).toBe(200);
    const [coursesSql, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesSql).toContain('EXISTS (');
    expect(coursesSql).toContain('FROM enrollments e');
    expect(coursesSql).toContain('e.course_id = c.id');
    expect(coursesSql).toContain('e.user_id = $3');
    expect(coursesSql).toContain('e.org_id = $1');
    expect(coursesParams).toEqual(['org-1', 'en', 'p1']);
  });

  it('keeps the org-visibility predicate outside the relaxed language OR-group (tenant isolation)', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    await handler(baseReq({ orgId: 'org-1', language: 'en' }), {} as any);

    const [coursesSql] = mockQuery.mock.calls[0] as [string, unknown[]];
    // The published + org-enabled visibility predicate must stay an OUTER AND, never
    // inside the OR group. Otherwise SQL precedence (`A AND B OR C` = `(A AND B) OR C`)
    // would surface any enrolled course regardless of org/publish — a tenant leak.
    const enabledIdx = coursesSql.indexOf("access = 'enabled'");
    const orGroupIdx = coursesSql.indexOf('AND (');
    const orExistsIdx = coursesSql.indexOf('OR EXISTS');
    expect(enabledIdx).toBeGreaterThanOrEqual(0);
    expect(orGroupIdx).toBeGreaterThan(enabledIdx); // visibility precedes the OR-group paren
    expect(orExistsIdx).toBeGreaterThan(orGroupIdx); // the OR lives inside that group
  });

  it('defaults to "da" when language is missing or invalid', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1', language: 'fr' }), {} as any);

    expect(res.status).toBe(200);
    const [, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(coursesParams).toEqual(['org-1', 'da', 'p1']);
  });

  it('individual org: catalogue is published + saved language, org-access bypassed', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ kind: 'individual', language: 'en' }); // resolveVisibilityContext
    mockQuery
      .mockResolvedValueOnce([{ id: 'c1', title: 'A', language: 'en', is_published: true }]) // courses
      .mockResolvedValueOnce([]);                                                            // enrollments
    const res = await handler(baseReq({ orgId: 'ind-354', language: 'da' }), {} as any);
    expect(res.status).toBe(200);
    const coursesSql = mockQuery.mock.calls[0][0] as string;
    expect(coursesSql).not.toContain('org_course_access');
    expect(coursesSql).toContain('is_published = TRUE');
    // server-authoritative language: 'en' from the profile, not 'da' from the body
    expect(mockQuery.mock.calls[0][1]).toContain('en');
  });

  it('individual org: enrolled-relaxation survives — a course in a non-saved language stays visible', async () => {
    // Regression guard: the individual visibility fragment must be PUBLISHED-ONLY so the
    // shared OR-group owns the language filter. If language=$2 were baked into the outer
    // AND, boolean absorption (B AND (B OR D) ≡ B) would drop the enrolled-relaxation and
    // hide a course the learner already started after they switch their saved language.
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ kind: 'individual', language: 'en' }); // saved lang = en
    const daCourse = { id: 'c9', title: 'Dansk kursus', language: 'da', is_published: true };
    mockQuery
      .mockResolvedValueOnce([daCourse])                                                     // courses (row the SQL would return)
      .mockResolvedValueOnce([{ id: 'e9', org_id: 'ind-354', user_id: 'p1', course_id: 'c9', status: 'enrolled', enrolled_at: '2024-01-10', completed_at: null }]) // enrollments
      .mockResolvedValueOnce([{ course_id: 'c9', total: 3 }])                                 // totals
      .mockResolvedValueOnce([{ course_id: 'c9', completed: 1 }]);                            // completed

    const res = await handler(baseReq({ orgId: 'ind-354', language: 'da' }), {} as any);

    expect(res.status).toBe(200);
    const [coursesSql, coursesParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    // Visibility fragment is published-only: no language equality baked into the outer AND,
    // and org_course_access still bypassed. The language filter lives only in the OR-group.
    expect(coursesSql).toContain('c.is_published = TRUE');
    expect(coursesSql).not.toContain('org_course_access');
    // The enrolled-relaxation OR-group is present and carries the language + enrollment escape.
    expect(coursesSql).toContain('c.language = $2');
    expect(coursesSql).toContain('OR EXISTS (');
    expect(coursesSql).toContain('FROM enrollments e');
    // The discriminating structural guard: `c.language = $2` must appear ONLY inside the
    // OR-group (after its opening `AND (`), never in the outer visibility AND. A buggy
    // published+language visibility fragment would place it before the OR-group and absorb
    // the relaxation (B AND (B OR D) ≡ B); this ordering assertion fails in that case.
    expect(coursesSql.indexOf('c.language = $2')).toBeGreaterThan(coursesSql.indexOf('AND ('));
    // Saved language ('en') is bound as $2; the 'da' body language is ignored.
    expect(coursesParams).toEqual(['ind-354', 'en', 'p1']);
    // The da-language course the learner is enrolled in flows through unfiltered.
    expect(JSON.parse(res.body as string).courses).toEqual([daCourse]);
  });

  it('returns 200 for platform admin without calling isActiveMember', async () => {
    mockGetProfile.mockResolvedValueOnce({ id: 'p1', is_platform_admin: true });
    mockQuery
      .mockResolvedValueOnce([]) // courses query
      .mockResolvedValueOnce([]); // enrollments query

    const res = await handler(baseReq({ orgId: 'org-1' }), {} as any);

    expect(res.status).toBe(200);
    expect(mockIsActiveMember).not.toHaveBeenCalled();
  });

  it('returns 500 on db error', async () => {
    mockIsActiveMember.mockResolvedValueOnce(true);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const res = await handler(baseReq({ orgId: 'org-1' }), { error: vi.fn() } as any);

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal server error' });
  });
});
