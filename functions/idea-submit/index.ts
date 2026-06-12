import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { ideaId?: unknown };
    const { ideaId } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return corsResponse(origin, 400, { error: 'ideaId is required' });
    }

    // Load idea
    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
      [ideaId],
    );
    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' });

    // Author-only: no admin bypass — submitting someone else's idea is meaningless.
    if (idea.user_id !== profile.id) {
      return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    // Draft-only.
    if (idea.status !== 'draft') {
      return corsResponse(origin, 409, { error: 'Only draft ideas can be submitted' });
    }

    const submitted = await queryOne(
      `UPDATE ideas SET status = 'submitted', submitted_at = now() WHERE id = $1 RETURNING *`,
      [ideaId],
    );

    return corsResponse(origin, 200, { idea: submitted });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('idea-submit', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
