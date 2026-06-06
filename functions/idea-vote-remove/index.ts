import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { ideaId?: unknown };
    const { ideaId } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return corsResponse(origin, 400, { error: 'ideaId is required' }) as HttpResponseInit;
    }

    // Blind delete — no idea load; idempotent (parity with old client blind-delete)
    await query(
      `DELETE FROM idea_votes WHERE idea_id = $1 AND user_id = $2`,
      [ideaId, profile.id],
    );

    return corsResponse(origin, 200, { ok: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('idea-vote-remove', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
