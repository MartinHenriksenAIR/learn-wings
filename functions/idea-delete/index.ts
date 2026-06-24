import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
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

    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id FROM ideas WHERE id = $1`,
      [ideaId],
    );
    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' });

    // Authorization (OR of the RLS DELETE policies, provenance 20260202140817):
    //   - author may delete their own idea, any status
    //   - org admin may delete ideas in their org
    //   - platform admin (suite convention)
    let authorized = false;
    if (profile.is_platform_admin) {
      authorized = true;
    } else if (idea.user_id === profile.id) {
      authorized = true;
    } else if (await isOrgAdmin(profile.id, idea.org_id)) {
      authorized = true;
    }

    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // FK cascade handles idea_votes / idea_comments.
    await query(`DELETE FROM ideas WHERE id = $1`, [ideaId]);

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('idea-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
