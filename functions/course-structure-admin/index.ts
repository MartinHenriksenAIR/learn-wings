import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('course-structure-admin', async ({ req, reply }) => {
    const body = await req.json() as { courseId?: unknown };
    const { courseId } = body;

    if (!courseId || typeof courseId !== 'string') {
      return reply(400, { error: 'courseId is required' });
    }

    const course = await queryOne('SELECT * FROM courses WHERE id = $1', [courseId]);
    if (!course) {
      return reply(200, { course: null, modules: [] });
    }

    // `, id` tie-breaker (issue #46): legacy rows may carry duplicate sort_order
    // ranks; the tie-breaker keeps their relative order stable across reads.
    const [modules, lessons] = await Promise.all([
      query('SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order, id', [courseId]),
      query(
        `SELECT l.* FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = $1 ORDER BY l.sort_order, l.id`,
        [courseId],
      ),
    ]);

    // Group lessons by module_id in JS — no N+1
    const lessonsByModule = new Map<string, Record<string, unknown>[]>();
    for (const lesson of lessons as Record<string, unknown>[]) {
      const mid = lesson['module_id'] as string;
      if (!lessonsByModule.has(mid)) lessonsByModule.set(mid, []);
      lessonsByModule.get(mid)!.push(lesson);
    }

    const modulesWithLessons = (modules as Record<string, unknown>[]).map((m) => ({
      ...m,
      lessons: lessonsByModule.get(m['id'] as string) ?? [],
    }));

    return reply(200, { course, modules: modulesWithLessons });
});
