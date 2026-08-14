import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { loadIdea, isIdeaVisibleTo } from '../shared/ideas';

export default endpoint('idea-vote', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as { ideaId?: unknown };
  const { ideaId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  const idea = await loadIdea(ideaId);

  if (!idea) return reply(404, { error: 'Idea not found' });

  if (!isIdeaVisibleTo(idea, profile)) {
    return reply(404, { error: 'Idea not found' });
  }

  await requireActiveMember(idea.org_id);

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
