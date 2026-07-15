import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { PoolClient } from 'pg';

interface QuizOption {
  optionText: unknown;
  isCorrect: unknown;
}

interface QuizQuestion {
  questionText: unknown;
  sortOrder: unknown;
  options: unknown;
}

export default adminEndpoint('quiz-admin-save', async ({ req, reply }) => {
    const body = await req.json() as {
      lessonId?: unknown;
      passingScore?: unknown;
      questions?: unknown;
    };

    const { lessonId, passingScore, questions } = body;

    // ── Validate lessonId ────────────────────────────────────────────────────
    if (!lessonId || typeof lessonId !== 'string') {
      return reply(400, { error: 'lessonId is required' });
    }

    // ── Validate passingScore ────────────────────────────────────────────────
    if (!Number.isInteger(passingScore) || (passingScore as number) < 0 || (passingScore as number) > 100) {
      return reply(400, { error: 'passingScore must be an integer between 0 and 100' });
    }

    // ── Validate questions array ─────────────────────────────────────────────
    if (!Array.isArray(questions) || questions.length < 1) {
      return reply(400, { error: 'At least one question is required' });
    }

    // ── Validate each question and its options ───────────────────────────────
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi] as QuizQuestion;

      if (!q.questionText || typeof q.questionText !== 'string' || (q.questionText as string).trim() === '') {
        return reply(400, { error: `Question ${qi}: questionText is required` });
      }

      if (!Number.isInteger(q.sortOrder)) {
        return reply(400, { error: `Question ${qi}: sortOrder must be an integer` });
      }

      if (!Array.isArray(q.options) || (q.options as QuizOption[]).length < 2) {
        return reply(400, { error: 'Each question needs at least 2 options' });
      }

      const opts = q.options as QuizOption[];

      // Validate each option's field types first (isCorrect boolean check before aggregate hasCorrect check)
      for (let oi = 0; oi < opts.length; oi++) {
        const o = opts[oi];

        if (!o.optionText || typeof o.optionText !== 'string' || (o.optionText as string).trim() === '') {
          return reply(400, { error: `Question ${qi}, option ${oi}: optionText is required` });
        }

        if (typeof o.isCorrect !== 'boolean') {
          return reply(400, { error: `Question ${qi}, option ${oi}: isCorrect must be a boolean` });
        }
      }

      const hasCorrect = opts.some((o) => o.isCorrect === true);
      if (!hasCorrect) {
        return reply(400, { error: 'Each question needs a correct answer' });
      }
    }

    // ── Atomic transaction: upsert quiz, replace questions+options ───────────
    const quiz = await withTransaction(async (client: PoolClient) => {
      // 1. Upsert quiz by lesson_id (UNIQUE constraint is the conflict arbiter)
      const upsertResult = await client.query(
        `INSERT INTO quizzes (lesson_id, passing_score)
         VALUES ($1, $2)
         ON CONFLICT (lesson_id) DO UPDATE SET passing_score = EXCLUDED.passing_score
         RETURNING id, lesson_id, passing_score`,
        [lessonId as string, passingScore as number],
      );
      const savedQuiz = upsertResult.rows[0] as { id: string; lesson_id: string; passing_score: number };

      // 2. Delete all existing questions (CASCADE deletes their options)
      await client.query(
        'DELETE FROM quiz_questions WHERE quiz_id = $1',
        [savedQuiz.id],
      );

      // 3. Re-insert questions and options in array order
      for (const q of questions as QuizQuestion[]) {
        const qInsert = await client.query(
          `INSERT INTO quiz_questions (quiz_id, question_text, sort_order)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [savedQuiz.id, q.questionText as string, q.sortOrder as number],
        );
        const questionId = (qInsert.rows[0] as { id: string }).id;

        const opts = q.options as QuizOption[];

        // Build multi-row VALUES for all options in one insert.
        // sort_order = array index: old client inserted without sort_order leaving all 0/nondeterministic;
        // this makes learner-side ordering deterministic.
        const valuePlaceholders: string[] = [];
        const optParams: unknown[] = [questionId];
        for (let oi = 0; oi < opts.length; oi++) {
          const base = optParams.length; // 1-indexed placeholder offset
          valuePlaceholders.push(`($1, $${base + 1}, $${base + 2}, $${base + 3})`);
          optParams.push(opts[oi].optionText as string, opts[oi].isCorrect as boolean, oi);
        }

        await client.query(
          `INSERT INTO quiz_options (question_id, option_text, is_correct, sort_order)
           VALUES ${valuePlaceholders.join(', ')}`,
          optParams,
        );
      }

      return savedQuiz;
    });

    return reply(200, { quiz });
});
