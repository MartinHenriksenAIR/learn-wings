import { endpoint } from '../shared/endpoint';
import { ASSESSMENT_QUESTIONS, QUESTIONNAIRE_VERSION } from '../shared/assessment-questions';

export default endpoint('assessment-questions', async ({ reply }) => {
  return reply(200, {
    version: QUESTIONNAIRE_VERSION,
    questions: ASSESSMENT_QUESTIONS.map((q) => ({ id: q.id, options: [...q.options] })),
  });
});
