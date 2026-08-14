import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { profileJson } from '../shared/profile-json';
import { loadIdea, isIdeaVisibleTo } from '../shared/ideas';

export default endpoint('idea-comment-create', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as { ideaId?: unknown; content?: unknown; parentCommentId?: unknown };
  const { ideaId, content, parentCommentId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }
  if (!content || typeof content !== 'string') {
    return reply(400, { error: 'content is required' });
  }
  if (parentCommentId !== undefined && typeof parentCommentId !== 'string') {
    return reply(400, { error: 'parentCommentId must be a string' });
  }

  const idea = await loadIdea(ideaId);

  if (!idea) return reply(404, { error: 'Idea not found' });

  if (!isIdeaVisibleTo(idea, profile)) {
    return reply(404, { error: 'Idea not found' });
  }

  await requireActiveMember(idea.org_id);

  if (parentCommentId !== undefined) {
    const parentComment = await queryOne<{ idea_id: string }>(
      `SELECT idea_id FROM idea_comments WHERE id = $1`,
      [parentCommentId],
    );
    if (!parentComment || parentComment.idea_id !== ideaId) {
      return reply(400, { error: 'parentCommentId must reference a comment on this idea' });
    }
  }

  const comment = await queryOne(
    `WITH ins AS (
       INSERT INTO idea_comments (idea_id, org_id, user_id, content, parent_comment_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *
     )
     SELECT ins.*, ${profileJson('pr')} AS profile
     FROM ins JOIN profiles pr ON pr.id = ins.user_id`,
    [ideaId, idea.org_id, profile.id, content, (parentCommentId as string | undefined) ?? null],
  );

  return reply(200, { comment });
});
