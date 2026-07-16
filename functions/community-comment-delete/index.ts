import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface CommentWithPost {
  user_id: string;
  is_hidden: boolean;
  scope: 'org' | 'global';
  org_id: string | null;
}

export default endpoint('community-comment-delete', async ({ req, profile, reply }) => {
  const body = await req.json() as { commentId?: unknown };
  const { commentId } = body;

  if (!commentId || typeof commentId !== 'string') {
    return reply(400, { error: 'commentId is required' });
  }

  // Load comment + its post (same join as update for consistency)
  const comment = await queryOne<CommentWithPost>(
    `SELECT c.user_id, c.is_hidden, p.scope, p.org_id
     FROM community_comments c
     JOIN community_posts p ON p.id = c.post_id
     WHERE c.id = $1`,
    [commentId],
  );
  if (!comment) return reply(404, { error: 'Comment not found' });

  // Authorization (OR of RLS DELETE policies)
  // NOTE: author CAN delete their own comment even when hidden (no is_hidden condition — RLS asymmetry vs UPDATE)
  let authorized = false;

  if (comment.user_id === profile.id) {
    authorized = true;
  } else if (profile.is_platform_admin) {
    authorized = true;
  } else if (comment.scope === 'org' && comment.org_id && await isOrgAdmin(profile.id, comment.org_id)) {
    authorized = true;
  }

  if (!authorized) return reply(403, { error: 'Forbidden' });

  // DELETE — child replies cascade via FK
  await queryOne(
    `DELETE FROM community_comments WHERE id = $1`,
    [commentId],
  );

  return reply(200, { ok: true });
});
