import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('exercise-admin', async ({ req, reply }) => {
  const { lessonId } = await req.json() as { lessonId?: unknown };
  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }
  const exercise = await queryOne<{ id: string; lesson_id: string; exercise_kind: string; config: unknown }>(
    'SELECT id, lesson_id, exercise_kind, config FROM exercises WHERE lesson_id = $1',
    [lessonId],
  );
  // No exercise yet — empty editor state (maybeSingle parity; NOT 404)
  return reply(200, { exercise: exercise ?? null });
});
