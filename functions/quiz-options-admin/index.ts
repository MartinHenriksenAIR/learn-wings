import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' });

    const { quizId } = await req.json() as { quizId: string };
    // is_correct exposed only to platform admin
    const options = await query(
      `SELECT qo.id, qo.option_text, qo.is_correct, qo.sort_order, qo.question_id
       FROM quiz_options qo
       JOIN quiz_questions qq ON qq.id = qo.question_id
       WHERE qq.quiz_id = $1 ORDER BY qq.sort_order, qo.sort_order`,
      [quizId]
    );
    return corsResponse(origin, 200, options);
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' });
  }
}

export default handler;
app.http('quiz-options-admin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
