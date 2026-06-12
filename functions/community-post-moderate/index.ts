import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface PostRow {
  scope: 'org' | 'global';
  org_id: string | null;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as {
      postId?: unknown;
      isHidden?: unknown;
      isLocked?: unknown;
    };
    const { postId, isHidden, isLocked } = body;

    if (!postId || typeof postId !== 'string') {
      return corsResponse(origin, 400, { error: 'postId is required' });
    }
    if (isHidden === undefined && isLocked === undefined) {
      return corsResponse(origin, 400, { error: 'Provide isHidden or isLocked to update' });
    }
    if (isHidden !== undefined && typeof isHidden !== 'boolean') {
      return corsResponse(origin, 400, { error: 'isHidden must be a boolean' });
    }
    if (isLocked !== undefined && typeof isLocked !== 'boolean') {
      return corsResponse(origin, 400, { error: 'isLocked must be a boolean' });
    }

    // Load post
    const post = await queryOne<PostRow>(
      `SELECT scope, org_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return corsResponse(origin, 404, { error: 'Post not found' });

    // Authorization: platform admin OR (org post AND org admin)
    // Global posts: platform admin only
    const canAccess = profile.is_platform_admin ||
      (post.scope === 'org' && post.org_id !== null && await isOrgAdmin(profile.id, post.org_id));
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Build dynamic UPDATE
    const params: unknown[] = [];
    const setClauses: string[] = [];

    if (isHidden !== undefined) {
      params.push(isHidden);
      setClauses.push(`is_hidden = $${params.length}`);
    }
    if (isLocked !== undefined) {
      params.push(isLocked);
      setClauses.push(`is_locked = $${params.length}`);
    }

    params.push(postId);
    const idIndex = params.length;

    const updatedPost = await queryOne(
      `UPDATE community_posts SET ${setClauses.join(', ')} WHERE id = $${idIndex} RETURNING *`,
      params,
    );

    return corsResponse(origin, 200, { post: updatedPost });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('community-post-moderate', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
