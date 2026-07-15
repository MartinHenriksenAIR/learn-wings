import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember, isOrgAdmin } from '../shared/profile';

interface PostRow {
  scope: 'org' | 'global';
  org_id: string | null;
}

export default endpoint('community-comments', async ({ req, profile, reply }) => {
    const body = await req.json() as { postId?: unknown };
    const { postId } = body;

    if (!postId || typeof postId !== 'string') {
      return reply(400, { error: 'postId is required' });
    }

    // Load the post to check access
    const [post] = await query<PostRow>(
      `SELECT scope, org_id FROM community_posts WHERE id = $1`,
      [postId],
    );

    // Post missing → parity with old client SELECT returning zero rows
    if (!post) return reply(200, { comments: [] });

    // Scope visibility check (can_access_community_post parity)
    if (post.scope === 'org') {
      const canAccess = profile.is_platform_admin ||
        await isActiveMember(profile.id, post.org_id!);
      if (!canAccess) return reply(200, { comments: [] });
    }

    // Hidden-comment visibility: platform admin or org admin of the post's org (global posts: only platform admin)
    const includeHidden = profile.is_platform_admin ||
      (post.scope === 'org' && await isOrgAdmin(profile.id, post.org_id!));

    const hiddenClause = includeHidden ? '' : 'AND c.is_hidden = false';

    const comments = await query(
      `SELECT c.*, json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile
       FROM community_comments c
       JOIN profiles pr ON pr.id = c.user_id
       WHERE c.post_id = $1 ${hiddenClause}
       ORDER BY c.created_at ASC`,
      [postId],
    );

    return reply(200, { comments });
});
