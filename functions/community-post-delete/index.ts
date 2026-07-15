import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface PostRow {
  user_id: string;
  scope: 'org' | 'global';
  org_id: string | null;
  category_id: string;
}

export default endpoint('community-post-delete', async ({ req, profile, reply }) => {
    const body = await req.json() as { postId?: unknown };
    const { postId } = body;

    if (!postId || typeof postId !== 'string') {
      return reply(400, { error: 'postId is required' });
    }

    const post = await queryOne<PostRow>(
      `SELECT user_id, scope, org_id, category_id FROM community_posts WHERE id = $1`,
      [postId],
    );
    if (!post) return reply(404, { error: 'Post not found' });

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

    if (!authorized) return reply(403, { error: 'Forbidden' });

    await query(`DELETE FROM community_posts WHERE id = $1`, [postId]);

    return reply(200, { ok: true });
});
