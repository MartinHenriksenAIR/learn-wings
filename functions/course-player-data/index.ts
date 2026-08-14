import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { siblingEnrollmentExists } from '../shared/course-groups';
import { resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('course-player-data', async ({ req, profile, reply, requireActiveMember }) => {
  const { courseId, orgId } = await req.json() as { courseId: string; orgId: string };

  const course = await queryOne('SELECT * FROM courses WHERE id = $1', [courseId]);
  if (!course) return reply(404, { error: 'Course not found' });

  const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);

  if (!profile.is_platform_admin) {
    if (isIndividual) {
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
