import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface IdeaRow {
  id: string;
  org_id: string;
}

function isValidScore(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3);
}

export default endpoint('idea-prioritize', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { ideaId?: unknown; value?: unknown; effort?: unknown };
  const { ideaId, value, effort } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }
  if (!isValidScore(value)) {
    return reply(400, { error: 'value must be an integer 1-3 or null' });
  }
  if (!isValidScore(effort)) {
    return reply(400, { error: 'effort must be an integer 1-3 or null' });
  }
  if ((value === null) !== (effort === null)) {
    return reply(400, { error: 'value and effort must both be set or both be null' });
  }

  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id FROM ideas WHERE id = $1`,
    [ideaId],
  );
  if (!idea) return reply(404, { error: 'Idea not found' });

  await requireOrgAdmin(idea.org_id);

  const updated = await queryOne(
    `UPDATE ideas SET value_score = $1, effort_score = $2 WHERE id = $3 RETURNING *`,
    [value, effort, ideaId],
  );

  return reply(200, { idea: updated });
});
