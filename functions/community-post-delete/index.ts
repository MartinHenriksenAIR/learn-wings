import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface PostRow {
  user_id: string;
  scope: 'org' | 'global';
  org_id: string | null;
  category_id: string;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { postId?: unknown };
    const { postId } = body;

    if (!postId || typeof postId !== 'string') {
      return corsResponse(origin, 400, { error: 'postId is required' });
    }

    const post = await queryOne<PostRow>(
      `SELECT user_id, scope, org_id, category_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return corsResponse(origin, 404, { error: 'Post not found' });

    // Authorization (OR of three RLS DELETE policies)
    let authorized = false;

    if (profile.is_platform_admin) {
      authorized = true;
    } else if (post.scope === 'org' && post.org_id && await isOrgAdmin(profile.id, post.org_id)) {
      authorized = true;
    } else if (post.user_id === profile.id) {
      // Author can delete only if the post's category is not restricted
      const categoryRow = await queryOne<{ is_restricted: boolean }>(
        `SELECT is_restricted FROM community_categories WHERE id = $1`,
        [post.category_id],
      );
      if (!categoryRow?.is_restricted) {
        authorized = true;
      }
    }

    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    await query(`DELETE FROM community_posts WHERE id = $1`, [postId]);

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('community-post-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
