import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface PostRow {
  scope: 'org' | 'global';
  org_id: string | null;
}

export default endpoint('community-post-moderate', async ({ req, profile, reply }) => {
    const body = await req.json() as {
      postId?: unknown;
      isHidden?: unknown;
      isLocked?: unknown;
    };
    const { postId, isHidden, isLocked } = body;

    if (!postId || typeof postId !== 'string') {
      return reply(400, { error: 'postId is required' });
    }
    if (isHidden === undefined && isLocked === undefined) {
      return reply(400, { error: 'Provide isHidden or isLocked to update' });
    }
    if (isHidden !== undefined && typeof isHidden !== 'boolean') {
      return reply(400, { error: 'isHidden must be a boolean' });
    }
    if (isLocked !== undefined && typeof isLocked !== 'boolean') {
      return reply(400, { error: 'isLocked must be a boolean' });
    }

    // Load post
    const post = await queryOne<PostRow>(
      `SELECT scope, org_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return reply(404, { error: 'Post not found' });

    // Authorization: platform admin OR (org post AND org admin)
    // Global posts: platform admin only
    const canAccess = profile.is_platform_admin ||
      (post.scope === 'org' && post.org_id !== null && await isOrgAdmin(profile.id, post.org_id));
    if (!canAccess) return reply(403, { error: 'Forbidden' });

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

    return reply(200, { post: updatedPost });
});
