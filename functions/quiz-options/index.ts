import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    await authenticate(req); // auth required, role not checked — access checked via course-player-data
    const { questionId } = await req.json() as { questionId: string };
    // Explicitly exclude is_correct — never expose to learner
    const options = await query(
      'SELECT id, option_text, sort_order FROM quiz_options WHERE question_id = $1 ORDER BY sort_order',
      [questionId]
    );
    return corsResponse(origin, 200, options);
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' });
  }
}

export default handler;
app.http('quiz-options', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
