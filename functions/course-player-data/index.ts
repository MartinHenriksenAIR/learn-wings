import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('course-player-data', async ({ req, profile, reply }) => {
  const { courseId, orgId } = await req.json() as { courseId: string; orgId: string };

  const course = await queryOne('SELECT * FROM courses WHERE id = $1', [courseId]);
  if (!course) return reply(404, { error: 'Course not found' });

  // Access check — platform admins bypass (suite convention); everyone else needs an active
  // membership in an org that has this course enabled and published (parity with quiz-by-lesson).
  if (!profile.is_platform_admin) {
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

  return reply(200, { course, modules: modulesWithLessons, progressMap, review: review ?? null });
});
