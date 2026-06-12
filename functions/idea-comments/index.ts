import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
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

    // Missing idea → RLS parity: return empty (not 404)
    if (!idea) return corsResponse(origin, 200, { comments: [] });

    // Draft privacy: other-author's draft is invisible (no admin bypass)
    if (idea.status === 'draft' && idea.user_id !== profile.id) {
      return corsResponse(origin, 200, { comments: [] });
    }

    // Access: platform admin OR active member of idea's org
    const canAccess = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
    if (!canAccess) return corsResponse(origin, 200, { comments: [] });

    const comments = await query(
      `SELECT c.*, json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile
       FROM idea_comments c
       JOIN profiles pr ON pr.id = c.user_id
       WHERE c.idea_id = $1
       ORDER BY c.created_at ASC`,
      [ideaId],
    );

    return corsResponse(origin, 200, { comments });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('idea-comments', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
