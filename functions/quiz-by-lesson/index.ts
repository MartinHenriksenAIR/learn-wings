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

    const { lessonId } = await req.json() as { lessonId?: unknown };

    if (!lessonId || typeof lessonId !== 'string') {
      return corsResponse(origin, 400, { error: 'lessonId is required' }) as HttpResponseInit;
    }

    // Access check — skip entirely for platform admins
    if (!profile.is_platform_admin) {
      const access = await queryOne<{ ok: boolean }>(
        // Check that the calling user has an active membership in an org that has this lesson's course enabled
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
      if (!access?.ok) return corsResponse(origin, 403, { error: 'Quiz access denied' }) as HttpResponseInit;
    }

    // Fetch the quiz for this lesson; if none, return early — no further queries
    const quiz = await queryOne<{ id: string; lesson_id: string; passing_score: number }>(
      'SELECT id, lesson_id, passing_score FROM quizzes WHERE lesson_id = $1',
      [lessonId],
    );
    if (!quiz) return corsResponse(origin, 200, { quiz: null, questions: [] }) as HttpResponseInit;

    // Fetch questions ordered by sort_order
    const questions = await query<{ id: string; quiz_id: string; question_text: string; sort_order: number }>(
      'SELECT id, quiz_id, question_text, sort_order FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order',
      [quiz.id],
    );

    // If no questions, skip options query entirely
    if (questions.length === 0) {
      return corsResponse(origin, 200, { quiz, questions: [] }) as HttpResponseInit;
    }

    // Batched options fetch — no N+1; is_correct is intentionally excluded (security: never expose correct answer)
    const questionIds = questions.map(q => q.id);
    const options = await query<{ id: string; question_id: string; option_text: string; sort_order: number }>(
      'SELECT id, question_id, option_text, sort_order FROM quiz_options WHERE question_id = ANY($1::uuid[]) ORDER BY sort_order',
      [questionIds],
    );

    // Group options by question_id preserving the per-question sort_order from SQL
    const optionsByQuestion = new Map<string, typeof options>();
    for (const opt of options) {
      const bucket = optionsByQuestion.get(opt.question_id) ?? [];
      bucket.push(opt);
      optionsByQuestion.set(opt.question_id, bucket);
    }

    const questionsWithOptions = questions.map(q => ({
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
app.http('quiz-by-lesson', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
