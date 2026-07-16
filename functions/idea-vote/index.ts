import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

export default endpoint('idea-vote', async ({ req, profile, reply, requireActiveMember }) => {
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

  // Not found → 404
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Draft privacy: other-author's draft is invisible (no admin bypass)
  if (idea.status === 'draft' && idea.user_id !== profile.id) {
    return reply(404, { error: 'Idea not found' });
  }

  // Authz: platform admin OR active member of idea's org
  await requireActiveMember(idea.org_id);

  // Insert vote; catch unique violation
  try {
    await queryOne(
      `INSERT INTO idea_votes (idea_id, org_id, user_id) VALUES ($1, $2, $3)`,
      [ideaId, idea.org_id, profile.id],
    );
  } catch (insertErr: unknown) {
    if (isUniqueViolation(insertErr)) {
      return reply(409, { error: 'You have already voted for this idea.' });
    }
    throw insertErr;
  }

  return reply(200, { ok: true });
});
