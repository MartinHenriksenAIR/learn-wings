import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
  [key: string]: unknown;
}

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

    const idea = await queryOne<IdeaRow>(`
      SELECT i.*,
        json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile,
        json_build_object('id', o.id, 'name', o.name) AS organization,
        (SELECT count(*)::int FROM idea_comments c WHERE c.idea_id = i.id) AS comment_count,
        (SELECT count(*)::int FROM idea_votes v WHERE v.idea_id = i.id) AS vote_count,
        EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = $2) AS user_has_voted
      FROM ideas i
      JOIN profiles pr ON pr.id = i.user_id
      JOIN organizations o ON o.id = i.org_id
      WHERE i.id = $1
    `, [ideaId, profile.id]);

    // Not found → null (parity with Supabase .single() PGRST116)
    if (!idea) return corsResponse(origin, 200, { idea: null }) as HttpResponseInit;

    // Org access: platform admin OR active member of the idea's org
    const canAccessOrg = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
    if (!canAccessOrg) return corsResponse(origin, 200, { idea: null }) as HttpResponseInit;

    // Draft privacy: drafts are author-private for EVERY role (no admin bypass).
    if (idea.status === 'draft' && idea.user_id !== profile.id) {
      return corsResponse(origin, 200, { idea: null }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { idea }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('idea', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
