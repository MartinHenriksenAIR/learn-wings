import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
}

export default endpoint('idea-submit', async ({ req, profile, reply }) => {
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
    if (!idea) return reply(404, { error: 'Idea not found' });

    // Author-only: no admin bypass — submitting someone else's idea is meaningless.
    if (idea.user_id !== profile.id) {
      return reply(403, { error: 'Forbidden' });
    }

    // Draft-only.
    if (idea.status !== 'draft') {
      return reply(409, { error: 'Only draft ideas can be submitted' });
    }

    const submitted = await queryOne(
      `UPDATE ideas SET status = 'submitted', submitted_at = now() WHERE id = $1 RETURNING *`,
      [ideaId],
    );

    return reply(200, { idea: submitted });
});
