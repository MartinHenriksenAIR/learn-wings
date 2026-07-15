import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface CommentWithPost {
  user_id: string;
  is_hidden: boolean;
  scope: 'org' | 'global';
  org_id: string | null;
}

export default endpoint('community-comment-update', async ({ req, profile, reply }) => {
    const body = await req.json() as { commentId?: unknown; content?: unknown };
    const { commentId, content } = body;

    if (!commentId || typeof commentId !== 'string') {
      return reply(400, { error: 'commentId is required' });
    }
    if (!content || typeof content !== 'string') {
      return reply(400, { error: 'content is required' });
    }

    // Load comment + its post
    const comment = await queryOne<CommentWithPost>(
      `SELECT c.user_id, c.is_hidden, p.scope, p.org_id
       FROM community_comments c
       JOIN community_posts p ON p.id = c.post_id
       WHERE c.id = $1`,
      [commentId],
    );
    if (!comment) return reply(404, { error: 'Comment not found' });

    // Authorization (OR of RLS UPDATE policies)
    let authorized = false;

    if (profile.is_platform_admin) {
      authorized = true;
    } else if (comment.scope === 'org' && comment.org_id && await isOrgAdmin(profile.id, comment.org_id)) {
      authorized = true;
    } else if (comment.user_id === profile.id && comment.is_hidden === false) {
      // Author can update only if comment is not hidden
      authorized = true;
    }

    if (!authorized) return reply(403, { error: 'Forbidden' });

    const updated = await queryOne(
      `UPDATE community_comments SET content = $1 WHERE id = $2 RETURNING *`,
      [content, commentId],
    );

    return reply(200, { comment: updated });
});
