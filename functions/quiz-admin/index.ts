import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    const body = await req.json() as { lessonId?: unknown };
    const { lessonId } = body;

    if (!lessonId || typeof lessonId !== 'string') {
      return corsResponse(origin, 400, { error: 'lessonId is required' }) as HttpResponseInit;
    }

    const quiz = await queryOne<{ id: string; lesson_id: string; passing_score: number }>(
      'SELECT id, lesson_id, passing_score FROM quizzes WHERE lesson_id = $1',
      [lessonId],
    );

    // No quiz for this lesson — return empty editor state (maybeSingle parity; NOT 404)
    if (!quiz) {
      return corsResponse(origin, 200, { quiz: null, questions: [] }) as HttpResponseInit;
    }

    const questions = await query<{ id: string; quiz_id: string; question_text: string; sort_order: number }>(
      'SELECT id, quiz_id, question_text, sort_order FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order',
      [quiz.id],
    );

    // Batched options fetch using JOIN on quiz_id — eliminates N+1.
    // Admin editor receives is_correct (this is the platform-admin endpoint; RLS parity).
    const options = await query<{
      id: string;
      question_id: string;
      option_text: string;
      is_correct: boolean;
      sort_order: number;
    }>(
      `SELECT o.id, o.question_id, o.option_text, o.is_correct, o.sort_order
         FROM quiz_options o
         JOIN quiz_questions q ON q.id = o.question_id
        WHERE q.quiz_id = $1
        ORDER BY o.sort_order`,
      [quiz.id],
    );

    // Group options by question_id in JS — course-structure-admin Map-grouping pattern
    const optionsByQuestion = new Map<string, typeof options>();
    for (const opt of options) {
      const bucket = optionsByQuestion.get(opt.question_id) ?? [];
      bucket.push(opt);
      optionsByQuestion.set(opt.question_id, bucket);
    }

    const questionsWithOptions = questions.map((q) => ({
      ...q,
      options: optionsByQuestion.get(q.id) ?? [],
    }));

    return corsResponse(origin, 200, { quiz, questions: questionsWithOptions }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('quiz-admin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
