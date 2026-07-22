import { withTransaction } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { QUESTIONNAIRE_VERSION, evaluateAnswers } from '../shared/assessment-questions';

export default endpoint('assessment-submit', async ({ req, profile, reply }) => {
  const { answers } = await req.json() as { answers?: unknown };

  const result = evaluateAnswers(answers);
  if (!result.ok) {
    return reply(400, { error: result.error });
  }

  const { score, level } = result;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO assessment_attempts (user_id, score, level, answers, questionnaire_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [profile.id, score, level, JSON.stringify(answers), QUESTIONNAIRE_VERSION],
    );
    await client.query(
      `UPDATE profiles SET assessment_level = $1 WHERE id = $2`,
      [level, profile.id],
    );
  });

  return reply(200, { score, level });
});
