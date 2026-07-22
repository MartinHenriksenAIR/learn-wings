import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface IdeaRow {
  id: string;
  org_id: string;
}

// null (clear) or an integer 1-3. Anything else → invalid.
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
  // A half-score (one column set, the other null) has no meaning — every
  // consumer treats it as unscored. Reject it so the stored state is always
  // either fully scored or fully cleared.
  if ((value === null) !== (effort === null)) {
    return reply(400, { error: 'value and effort must both be set or both be null' });
  }

  // Load idea (org_id is the authz anchor — never client-supplied).
  const idea = await queryOne<IdeaRow>(
    `SELECT id, org_id FROM ideas WHERE id = $1`,
    [ideaId],
  );
  if (!idea) return reply(404, { error: 'Idea not found' });

  // Authorization: platform admin OR org admin of the IDEA's org. Scoring is
  // admin-only and orthogonal to status; authorship grants nothing here.
  await requireOrgAdmin(idea.org_id);

  const updated = await queryOne(
    `UPDATE ideas SET value_score = $1, effort_score = $2 WHERE id = $3 RETURNING *`,
    [value, effort, ideaId],
  );

  return reply(200, { idea: updated });
});
