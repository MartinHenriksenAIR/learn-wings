import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface CommentPostRow {
  scope: 'org' | 'global';
  org_id: string | null;
}

export default endpoint('community-comment-moderate', async ({ req, profile, reply }) => {
    const body = await req.json() as {
      commentId?: unknown;
      isHidden?: unknown;
    };
    const { commentId, isHidden } = body;

    if (!commentId || typeof commentId !== 'string') {
      return reply(400, { error: 'commentId is required' });
    }
    if (isHidden === undefined || typeof isHidden !== 'boolean') {
      return reply(400, { error: 'isHidden is required and must be a boolean' });
    }

    // Load comment + post scope
    const row = await queryOne<CommentPostRow>(
      `SELECT p.scope, p.org_id FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.id = $1`,
      [commentId],
    );
    if (!row) return reply(404, { error: 'Comment not found' });

    // Authorization: platform admin OR (org post AND org admin)
    // Comments on global posts: platform admin only
    const canAccess = profile.is_platform_admin ||
      (row.scope === 'org' && row.org_id !== null && await isOrgAdmin(profile.id, row.org_id));
    if (!canAccess) return reply(403, { error: 'Forbidden' });

    const updatedComment = await queryOne(
      `UPDATE community_comments SET is_hidden = $1 WHERE id = $2 RETURNING *`,
      [isHidden, commentId],
    );

    return reply(200, { comment: updatedComment });
});
