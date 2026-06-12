import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne, isUniqueViolation } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
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

    // Not found → 404
    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' });

    // Draft privacy: other-author's draft is invisible (no admin bypass)
    if (idea.status === 'draft' && idea.user_id !== profile.id) {
      return corsResponse(origin, 404, { error: 'Idea not found' });
    }

    // Authz: platform admin OR active member of idea's org
    const canAccess = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Insert vote; catch unique violation
    try {
      await queryOne(
        `INSERT INTO idea_votes (idea_id, org_id, user_id) VALUES ($1, $2, $3)`,
        [ideaId, idea.org_id, profile.id],
      );
    } catch (insertErr: unknown) {
      if (isUniqueViolation(insertErr)) {
        return corsResponse(origin, 409, { error: 'You have already voted for this idea.' });
      }
      throw insertErr;
    }

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('idea-vote', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
