import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

export default endpoint('idea-comments', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown };
  const { ideaId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  // Load idea
  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id, user_id, status FROM ideas WHERE id = $1`,
    [ideaId],
  );

  // Missing idea → RLS parity: return empty (not 404)
  if (!idea) return reply(200, { comments: [] });

  // Draft privacy: other-author's draft is invisible (no admin bypass)
  if (idea.status === 'draft' && idea.user_id !== profile.id) {
    return reply(200, { comments: [] });
  }

  // Access: platform admin OR active member of idea's org
  const canAccess = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
  if (!canAccess) return reply(200, { comments: [] });

  const comments = await query(
    `SELECT c.*, json_build_object('id', pr.id, 'full_name', pr.full_name) AS profile
     FROM idea_comments c
     JOIN profiles pr ON pr.id = c.user_id
     WHERE c.idea_id = $1
     ORDER BY c.created_at ASC`,
    [ideaId],
  );

  return reply(200, { comments });
});
