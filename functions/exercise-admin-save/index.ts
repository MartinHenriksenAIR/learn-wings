import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { validateExerciseConfig } from '../shared/exercises/config';
import { PoolClient } from 'pg';

export default adminEndpoint('exercise-admin-save', async ({ req, reply }) => {
  const body = await req.json() as { lessonId?: unknown; exerciseKind?: unknown; config?: unknown };
  const { lessonId, exerciseKind, config } = body;

  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }
  if (!exerciseKind || typeof exerciseKind !== 'string') {
    return reply(400, { error: 'exerciseKind is required' });
  }

  const configError = validateExerciseConfig(exerciseKind, config);
  if (configError) {
    return reply(400, { error: configError });
  }

  const exercise = await withTransaction(async (client: PoolClient) => {
    const result = await client.query(
      `INSERT INTO exercises (lesson_id, exercise_kind, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (lesson_id)
       DO UPDATE SET exercise_kind = EXCLUDED.exercise_kind, config = EXCLUDED.config
       RETURNING id, lesson_id, exercise_kind, config`,
      [lessonId, exerciseKind, JSON.stringify(config)],
    );
    return result.rows[0];
  });

  return reply(200, { exercise });
});
