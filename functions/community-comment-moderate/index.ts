import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface CommentPostRow {
  scope: 'org' | 'global';
  org_id: string | null;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as {
      commentId?: unknown;
      isHidden?: unknown;
    };
    const { commentId, isHidden } = body;

    if (!commentId || typeof commentId !== 'string') {
      return corsResponse(origin, 400, { error: 'commentId is required' }) as HttpResponseInit;
    }
    if (isHidden === undefined || typeof isHidden !== 'boolean') {
      return corsResponse(origin, 400, { error: 'isHidden is required and must be a boolean' }) as HttpResponseInit;
    }

    // Load comment + post scope
    const row = await queryOne<CommentPostRow>(
      `SELECT p.scope, p.org_id FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.id = $1`,
      [commentId],
    );
    if (!row) return corsResponse(origin, 404, { error: 'Comment not found' }) as HttpResponseInit;

    // Authorization: platform admin OR (org post AND org admin)
    // Comments on global posts: platform admin only
    const canAccess = profile.is_platform_admin ||
      (row.scope === 'org' && row.org_id !== null && await isOrgAdmin(profile.id, row.org_id));
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const updatedComment = await queryOne(
      `UPDATE community_comments SET is_hidden = $1 WHERE id = $2 RETURNING *`,
      [isHidden, commentId],
    );

    return corsResponse(origin, 200, { comment: updatedComment }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('community-comment-moderate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
