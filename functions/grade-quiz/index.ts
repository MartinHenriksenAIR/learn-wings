import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { quiz_id, answers } = await req.json() as { quiz_id: string; answers: Record<string, string> };

    // Access check — short-circuit for platform admins; otherwise check org membership
    if (!profile.is_platform_admin) {
      const access = await queryOne<{ has_access: boolean }>(
        `SELECT (
          EXISTS (
            SELECT 1 FROM quizzes qz
            JOIN lessons l ON l.id = qz.lesson_id
            JOIN course_modules cm ON cm.id = l.module_id
            JOIN courses c ON c.id = cm.course_id
            JOIN org_course_access oca ON oca.course_id = c.id
            JOIN org_memberships om ON om.org_id = oca.org_id
            WHERE qz.id = $2 AND c.is_published = TRUE
              AND oca.access = 'enabled' AND om.user_id = $1 AND om.status = 'active'
          )
        ) AS has_access`,
        [profile.id, quiz_id]
      );
      if (!access?.has_access) return corsResponse(origin, 403, { error: 'Quiz access denied' });
    }

    const quiz = await queryOne<{ id: string; passing_score: number }>(
      'SELECT id, passing_score FROM quizzes WHERE id = $1', [quiz_id]
    );
    if (!quiz) return corsResponse(origin, 404, { error: 'Quiz not found' });

    const questions = await query<{ id: string }>(
      'SELECT id FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order', [quiz_id]
    );

    let correct_count = 0;
    for (const q of questions) {
      const correctOptions = await query<{ id: string; is_correct: boolean }>(
        'SELECT id, is_correct FROM quiz_options WHERE question_id = $1', [q.id]
      );
      const correctOptionId = correctOptions.find(o => o.is_correct)?.id;
      if (correctOptionId && answers[q.id] === correctOptionId) correct_count++;
    }

    const total_questions = questions.length;
    const score = total_questions > 0 ? Math.round((correct_count / total_questions) * 100) : 0;
    const passed = score >= quiz.passing_score;
    const passing_score = quiz.passing_score;

    // Insert quiz_attempts server-side — never trust the client to record scores
    await query(
      `INSERT INTO quiz_attempts (org_id, user_id, quiz_id, score, passed, finished_at)
       SELECT om.org_id, $1, $2, $3, $4, NOW()
       FROM org_memberships om WHERE om.user_id = $1 AND om.status = 'active' LIMIT 1`,
      [profile.id, quiz_id, score, passed]
    );

    return corsResponse(origin, 200, { score, passed, passing_score, correct_count, total_questions });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('grade-quiz', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
