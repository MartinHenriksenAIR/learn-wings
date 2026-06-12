import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isActiveMember } from '../shared/profile';

interface PostRow {
  scope: 'org' | 'global';
  org_id: string | null;
  is_locked: boolean;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { postId?: unknown; content?: unknown; parentCommentId?: unknown };
    const { postId, content, parentCommentId } = body;

    if (!postId || typeof postId !== 'string') {
      return corsResponse(origin, 400, { error: 'postId is required' });
    }
    if (!content || typeof content !== 'string') {
      return corsResponse(origin, 400, { error: 'content is required' });
    }
    if (parentCommentId !== undefined && typeof parentCommentId !== 'string') {
      return corsResponse(origin, 400, { error: 'parentCommentId must be a string' });
    }

    // Load post
    const post = await queryOne<PostRow>(
      `SELECT scope, org_id, is_locked FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return corsResponse(origin, 404, { error: 'Post not found' });

    // Accessibility check (can_access_community_post parity) — before locked check
    if (!profile.is_platform_admin) {
      if (post.scope === 'org') {
        const canAccess = await isActiveMember(profile.id, post.org_id!);
        if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' });
      }
      // global scope: all authenticated profiles can access
    }

    // Locked check (after accessibility)
    if (post.is_locked) {
      return corsResponse(origin, 403, { error: 'Post is locked' });
    }

    // Insert with profile join via CTE (parity: old lib selected profile on inserted row)
    const comment = await queryOne(
      `WITH ins AS (
         INSERT INTO community_comments (post_id, user_id, content, parent_comment_id)
         VALUES ($1, $2, $3, $4) RETURNING *
       )
       SELECT ins.*, json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile
       FROM ins JOIN profiles pr ON pr.id = ins.user_id`,
      [postId, profile.id, content, (parentCommentId as string | undefined) ?? null],
    );

    return corsResponse(origin, 200, { comment });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('community-comment-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
