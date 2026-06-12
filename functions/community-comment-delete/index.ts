import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface CommentWithPost {
  user_id: string;
  is_hidden: boolean;
  scope: 'org' | 'global';
  org_id: string | null;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { commentId?: unknown };
    const { commentId } = body;

    if (!commentId || typeof commentId !== 'string') {
      return corsResponse(origin, 400, { error: 'commentId is required' });
    }

    // Load comment + its post (same join as update for consistency)
    const comment = await queryOne<CommentWithPost>(
      `SELECT c.user_id, c.is_hidden, p.scope, p.org_id
       FROM community_comments c
       JOIN community_posts p ON p.id = c.post_id
       WHERE c.id = $1`,
      [commentId],
    );
    if (!comment) return corsResponse(origin, 404, { error: 'Comment not found' });

    // Authorization (OR of RLS DELETE policies)
    // NOTE: author CAN delete their own comment even when hidden (no is_hidden condition — RLS asymmetry vs UPDATE)
    let authorized = false;

    if (comment.user_id === profile.id) {
      authorized = true;
    } else if (profile.is_platform_admin) {
      authorized = true;
    } else if (comment.scope === 'org' && comment.org_id && await isOrgAdmin(profile.id, comment.org_id)) {
      authorized = true;
    }

    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // DELETE — child replies cascade via FK
    await queryOne(
      `DELETE FROM community_comments WHERE id = $1`,
      [commentId],
    );

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('community-comment-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
