import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { loadIdea, assertAuthorDraft } from '../shared/ideas';

export default endpoint('idea-submit', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown };
  const { ideaId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  const idea = await loadIdea(ideaId);
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Author-only-403 + draft-only-409 (shared/ideas; no admin bypass).
  const gate = assertAuthorDraft(idea, profile, { notDraftError: 'Only draft ideas can be submitted' });
  if (!gate.ok) return reply(gate.status, gate.body);

  const submitted = await queryOne(
    `UPDATE ideas SET status = 'submitted', submitted_at = now() WHERE id = $1 RETURNING *`,
    [ideaId],
  );

  return reply(200, { idea: submitted });
});
