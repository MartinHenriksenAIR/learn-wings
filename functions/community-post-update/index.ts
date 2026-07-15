import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

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

export default endpoint('community-post-update', async ({ req, profile, reply }) => {
    const body = await req.json() as { postId?: unknown; updates?: unknown };
    const { postId, updates } = body;

    if (!postId || typeof postId !== 'string') {
      return reply(400, { error: 'postId is required' });
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return reply(400, { error: 'updates must be an object' });
    }

    const updatesObj = updates as Record<string, unknown>;

    // Validate update fields whitelist
    for (const key of Object.keys(updatesObj)) {
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        return reply(400, { error: `Invalid update field: ${key}` });
      }
    }

    // Collect whitelisted keys present in updates
    const updateKeys = Object.keys(updatesObj).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
    if (updateKeys.length === 0) {
      return reply(400, { error: 'No valid update fields provided' });
    }

    // Load post
    const post = await queryOne<PostRow>(
      `SELECT user_id, scope, org_id, is_hidden, category_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return reply(404, { error: 'Post not found' });

    // Authorization
    let authorized = false;

    if (profile.is_platform_admin) {
      authorized = true;
    } else if (post.scope === 'org' && post.org_id && await isOrgAdmin(profile.id, post.org_id)) {
      authorized = true;
    } else if (post.user_id === profile.id) {
      // Author can only edit if not hidden
      if (post.is_hidden) {
        return reply(403, { error: 'Forbidden' });
      }

      // Author cannot edit posts in restricted categories
      const currentCatRow = await queryOne<{ is_restricted: boolean }>(
        `SELECT is_restricted FROM community_categories WHERE id = $1`,
        [post.category_id],
      );
      if (currentCatRow?.is_restricted) {
        return reply(403, { error: 'Forbidden' });
      }

      // Author cannot move post into restricted category
      if (updatesObj.category_id && typeof updatesObj.category_id === 'string') {
        const newCatRow = await queryOne<{ is_restricted: boolean }>(
          `SELECT is_restricted FROM community_categories WHERE id = $1`,
          [updatesObj.category_id],
        );
        if (!newCatRow) {
          return reply(400, { error: 'Category not found' });
        }
        if (newCatRow.is_restricted) {
          return reply(403, { error: 'Forbidden' });
        }
      }

      authorized = true;
    }

    if (!authorized) return reply(403, { error: 'Forbidden' });

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

    return reply(200, { post: updatedPost });
});
