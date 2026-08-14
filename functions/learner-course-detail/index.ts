import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('learner-course-detail', async ({ req, profile, reply, requireActiveMember }) => {
  const { courseId, orgId } = await req.json() as { courseId?: unknown; orgId?: unknown };

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }
  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  const course = await queryOne(
    'SELECT id, title, description, level, language, thumbnail_url, category_id FROM courses WHERE id = $1',
    [courseId],
  );
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

  const moduleRows = await query<{ id: string; title: string; sort_order: number; lesson_count: number }>(
    `SELECT cm.id, cm.title, cm.sort_order, COUNT(l.id)::int AS lesson_count
       FROM course_modules cm
       LEFT JOIN lessons l ON l.module_id = cm.id
      WHERE cm.course_id = $1
      GROUP BY cm.id, cm.title, cm.sort_order
      ORDER BY cm.sort_order, cm.id`,
    [courseId],
  );

  const moduleIds = moduleRows.map((m) => m.id);
  const lessonRows = moduleIds.length
    ? await query<{ id: string; module_id: string; title: string; sort_order: number }>(
        `SELECT id, module_id, title, sort_order
           FROM lessons
          WHERE module_id = ANY($1)
          ORDER BY sort_order, id`,
        [moduleIds],
      )
    : [];

  const lessonsByModule = new Map<string, { id: string; title: string; sort_order: number }[]>();
  for (const { id, module_id, title, sort_order } of lessonRows) {
    const list = lessonsByModule.get(module_id) ?? [];
    list.push({ id, title, sort_order });
    lessonsByModule.set(module_id, list);
  }

  const modules = moduleRows.map((m) => ({ ...m, lessons: lessonsByModule.get(m.id) ?? [] }));

  const enrollment = await queryOne<{ status: string }>(
    'SELECT status FROM enrollments WHERE user_id = $1 AND org_id = $2 AND course_id = $3',
    [profile.id, orgId, courseId],
  );

  return reply(200, { course, modules, enrollment: enrollment ?? null });
});
