import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_UPDATE_FIELDS = new Set([
  'category_id',
  'title',
  'content',
  'tags',
  'event_date',
  'event_location',
  'event_registration_url',
]);

interface PostRow {
  user_id: string;
  scope: 'org' | 'global';
  org_id: string | null;
  is_hidden: boolean;
  category_id: string;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { postId?: unknown; updates?: unknown };
    const { postId, updates } = body;

    if (!postId || typeof postId !== 'string') {
      return corsResponse(origin, 400, { error: 'postId is required' });
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return corsResponse(origin, 400, { error: 'updates must be an object' });
    }

    const updatesObj = updates as Record<string, unknown>;

    // Validate update fields whitelist
    for (const key of Object.keys(updatesObj)) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        return corsResponse(origin, 400, { error: `Invalid update field: ${key}` });
      }
    }

    // Collect whitelisted keys present in updates
    const updateKeys = Object.keys(updatesObj).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
    if (updateKeys.length === 0) {
      return corsResponse(origin, 400, { error: 'No valid update fields provided' });
    }

    // Load post
    const post = await queryOne<PostRow>(
      `SELECT user_id, scope, org_id, is_hidden, category_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return corsResponse(origin, 404, { error: 'Post not found' });

    // Authorization
    let authorized = false;

    if (profile.is_platform_admin) {
      authorized = true;
    } else if (post.scope === 'org' && post.org_id && await isOrgAdmin(profile.id, post.org_id)) {
      authorized = true;
    } else if (post.user_id === profile.id) {
      // Author can only edit if not hidden
      if (post.is_hidden) {
        return corsResponse(origin, 403, { error: 'Forbidden' });
      }

      // Author cannot edit posts in restricted categories
      const currentCatRow = await queryOne<{ is_restricted: boolean }>(
        `SELECT is_restricted FROM community_categories WHERE id = $1`,
        [post.category_id],
      );
      if (currentCatRow?.is_restricted) {
        return corsResponse(origin, 403, { error: 'Forbidden' });
      }

      // Author cannot move post into restricted category
      if (updatesObj.category_id && typeof updatesObj.category_id === 'string') {
        const newCatRow = await queryOne<{ is_restricted: boolean }>(
          `SELECT is_restricted FROM community_categories WHERE id = $1`,
          [updatesObj.category_id],
        );
        if (!newCatRow) {
          return corsResponse(origin, 400, { error: 'Category not found' });
        }
        if (newCatRow.is_restricted) {
          return corsResponse(origin, 403, { error: 'Forbidden' });
        }
      }

      authorized = true;
    }

    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Build dynamic UPDATE
    const params: unknown[] = [];
    const setClauses = updateKeys.map((key) => {
      params.push(updatesObj[key]);
      return `${key} = $${params.length}`;
    });
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
app.http('community-post-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
