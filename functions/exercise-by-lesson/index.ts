import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('exercise-by-lesson', async ({ req, profile, reply }) => {
  const { lessonId } = await req.json() as { lessonId?: unknown };
  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }

  // Access check — skip entirely for platform admins (parity with quiz-by-lesson)
  if (!profile.is_platform_admin) {
    const access = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS(
        SELECT 1
          FROM lessons l
          JOIN course_modules cm ON cm.id = l.module_id
          JOIN courses c ON c.id = cm.course_id
          JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
          JOIN org_memberships om ON om.org_id = oca.org_id
         WHERE l.id = $2 AND c.is_published = TRUE AND om.user_id = $1 AND om.status = 'active'
      ) AS ok`,
      [profile.id, lessonId],
    );
    if (!access?.ok) return reply(403, { error: 'Exercise access denied' });
  }

  // Full config incl. answers — correctness is checked client-side (ADR-0017).
  const exercise = await queryOne<{ id: string; lesson_id: string; exercise_kind: string; config: unknown }>(
    'SELECT id, lesson_id, exercise_kind, config FROM exercises WHERE lesson_id = $1',
    [lessonId],
  );
  return reply(200, { exercise: exercise ?? null });
});
