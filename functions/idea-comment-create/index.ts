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
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { ideaId?: unknown; content?: unknown; parentCommentId?: unknown };
    const { ideaId, content, parentCommentId } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return corsResponse(origin, 400, { error: 'ideaId is required' });
    }
    if (!content || typeof content !== 'string') {
      return corsResponse(origin, 400, { error: 'content is required' });
    }
    if (parentCommentId !== undefined && typeof parentCommentId !== 'string') {
      return corsResponse(origin, 400, { error: 'parentCommentId must be a string' });
    }

    // Load idea
    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
      [ideaId],
    );

    if (!idea) return corsResponse(origin, 404, { error: 'Idea not found' });

    // Draft privacy: other-author's draft is invisible (no admin bypass)
    if (idea.status === 'draft' && idea.user_id !== profile.id) {
      return corsResponse(origin, 404, { error: 'Idea not found' });
    }

    // Authz: platform admin OR active member of idea's org
    const canAccess = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Validate parentCommentId if provided
    if (parentCommentId !== undefined) {
      const parentComment = await queryOne<{ idea_id: string }>(
        `SELECT idea_id FROM idea_comments WHERE id = $1`,
        [parentCommentId],
      );
      if (!parentComment || parentComment.idea_id !== ideaId) {
        return corsResponse(origin, 400, { error: 'parentCommentId must reference a comment on this idea' });
      }
    }

    // CTE insert with profile join (parity with community-comment-create)
    const comment = await queryOne(
      `WITH ins AS (
         INSERT INTO idea_comments (idea_id, org_id, user_id, content, parent_comment_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *
       )
       SELECT ins.*, json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile
       FROM ins JOIN profiles pr ON pr.id = ins.user_id`,
      [ideaId, idea.org_id, profile.id, content, (parentCommentId as string | undefined) ?? null],
    );

    return corsResponse(origin, 200, { comment });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('idea-comment-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
