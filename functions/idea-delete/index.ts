import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
}

export default endpoint('idea-delete', async ({ req, profile, reply }) => {
    const body = await req.json() as { ideaId?: unknown };
    const { ideaId } = body;

    if (!ideaId || typeof ideaId !== 'string') {
      return reply(400, { error: 'ideaId is required' });
    }

    const idea = await queryOne<IdeaRow>(
      `SELECT id, org_id, user_id FROM ideas WHERE id = $1`,
      [ideaId],
    );
    if (!idea) return reply(404, { error: 'Idea not found' });

    // Authorization (OR of the RLS DELETE policies, provenance 20260202140817):
    //   - author may delete their own idea, any status
    //   - org admin may delete ideas in their org
    //   - platform admin (suite convention)
    let authorized = false;
    if (profile.is_platform_admin) {
      authorized = true;
    } else if (idea.user_id === profile.id) {
      authorized = true;
    } else if (await isOrgAdmin(profile.id, idea.org_id)) {
      authorized = true;
    }

    if (!authorized) return reply(403, { error: 'Forbidden' });

    // FK cascade handles idea_votes / idea_comments.
    await query(`DELETE FROM ideas WHERE id = $1`, [ideaId]);

    return reply(200, { ok: true });
});
