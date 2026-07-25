import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember, isOrgAdmin } from '../shared/profile';
import { profileJson } from '../shared/profile-json';

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

  const [post] = await query<PostRow>(
    `SELECT scope, org_id FROM community_posts WHERE id = $1`,
    [postId],
  );

  if (!post) return reply(200, { comments: [] }); // parity: old client SELECT returned zero rows

  if (post.scope === 'org') {
    const canAccess = profile.is_platform_admin ||
      await isActiveMember(profile.id, post.org_id!);
    if (!canAccess) return reply(200, { comments: [] });
  }

  // Hidden-comment visibility: platform admin OR org admin of the post's org; global posts → platform admin only.
  const includeHidden = profile.is_platform_admin ||
    (post.scope === 'org' && await isOrgAdmin(profile.id, post.org_id!));

  const hiddenClause = includeHidden ? '' : 'AND c.is_hidden = false';

  const comments = await query(
    `SELECT c.*, ${profileJson('pr')} AS profile
     FROM community_comments c
     JOIN profiles pr ON pr.id = c.user_id
     WHERE c.post_id = $1 ${hiddenClause}
     ORDER BY c.created_at ASC`,
    [postId],
  );

  return reply(200, { comments });
});
