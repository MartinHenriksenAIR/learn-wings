import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { siblingEnrollmentExists } from '../shared/course-groups';
import { resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('course-player-data', async ({ req, profile, reply, requireActiveMember }) => {
  const { courseId, orgId } = await req.json() as { courseId: string; orgId: string };

  const course = await queryOne('SELECT * FROM courses WHERE id = $1', [courseId]);
  if (!course) return reply(404, { error: 'Course not found' });

  // Individual tier (#354) takes a different visibility rule than standard orgs; the
  // resolver also yields the caller's server-authoritative language. Resolved for all
  // callers (incl. platform admins) since `isIndividual` also branches the enroll below.
  const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);

  // Platform admins bypass (suite convention); everyone else needs an active
  // membership in an org that has this course enabled and published (parity with quiz-by-lesson).
  if (!profile.is_platform_admin) {
    if (isIndividual) {
      // Individual tier: active member of the placeholder + published + in the
      // caller's saved language (OR already enrolled, so a later language switch
      // never locks them out of a started course). org_course_access bypassed.
      await requireActiveMember(orgId);
      const access = await queryOne<{ ok: boolean }>(
        `SELECT (
           $3::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM courses c
              WHERE c.id = $2 AND c.is_published = TRUE
                AND (c.language = $3
                     OR EXISTS (SELECT 1 FROM enrollments e
                                 WHERE e.course_id = c.id AND e.user_id = $1 AND e.org_id = $4))))
         AS ok`,
        [profile.id, courseId, language, orgId],
      );
      if (!access?.ok) return reply(403, { error: 'Course access denied' });
    } else {
      const access = await queryOne<{ ok: boolean }>(
        `SELECT EXISTS(
          SELECT 1
            FROM courses c
            JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
            JOIN org_memberships om ON om.org_id = oca.org_id
           WHERE c.id = $2 AND c.is_published = TRUE AND om.user_id = $1 AND om.status = 'active'
        ) AS ok`,
        [profile.id, courseId],
      );
      if (!access?.ok) return reply(403, { error: 'Course access denied' });
    }
  }

  // `, id` tie-breaker (issue #46): legacy rows may carry duplicate sort_order
  // ranks; the tie-breaker keeps their relative order stable across reads.
  const modules = await query('SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order, id', [courseId]);
  const modulesWithLessons = await Promise.all(
    modules.map(async (m: Record<string, unknown>) => {
      const lessons = await query('SELECT * FROM lessons WHERE module_id = $1 ORDER BY sort_order, id', [m.id]);
      return { ...m, lessons };
    })
  );

  const progressRows = await query<{ lesson_id: string; status: string; completed_at: string }>(
    'SELECT lesson_id, status, completed_at FROM lesson_progress WHERE user_id = $1 AND org_id = $2',
    [profile.id, orgId]
  );
  const progressMap = Object.fromEntries(progressRows.map(p => [p.lesson_id, p]));

  const review = await queryOne(
    'SELECT id, rating, comment FROM course_reviews WHERE user_id = $1 AND org_id = $2 AND course_id = $3',
    [profile.id, orgId, courseId]
  );

  // Implicit enrollment (#357): opening a course auto-creates the enrollment so
  // lesson progress and certificates work without a manual enroll step. The INSERT
  // is self-gating for org isolation — it writes only when the caller is an active
  // member of THIS org, the org has the course enabled, and the course is published,
  // so a client can't fabricate an enrollment in an org it does not belong to.
  // Platform admins previewing without a membership create no row (matches the
  // suite's no-side-effect convention). #213: skipped when a sibling-language edition
  // is already enrolled in this org, preserving one-edition-per-org. #354: the individual
  // tier drops the org_course_access EXISTS (it has no such rows) but keeps every other gate.
  if (orgId) {
    const accessClause = isIndividual
      ? ''  // individual tier bypasses org_course_access
      : `AND EXISTS (SELECT 1 FROM org_course_access oca
                      WHERE oca.org_id = $1 AND oca.course_id = $3 AND oca.access = 'enabled')`;
    await query(
      `INSERT INTO enrollments (org_id, user_id, course_id, status)
       SELECT $1, $2, $3, 'enrolled'
        WHERE EXISTS (SELECT 1 FROM org_memberships om
                       WHERE om.org_id = $1 AND om.user_id = $2 AND om.status = 'active')
          ${accessClause}
          AND EXISTS (SELECT 1 FROM courses c
                       WHERE c.id = $3 AND c.is_published = TRUE)
          AND NOT ${siblingEnrollmentExists({ orgParam: 1, userParam: 2, courseParam: 3 })}
       ON CONFLICT (org_id, user_id, course_id) DO NOTHING`,
      [orgId, profile.id, courseId],
    );
  }

  return reply(200, { course, modules: modulesWithLessons, progressMap, review: review ?? null });
});
