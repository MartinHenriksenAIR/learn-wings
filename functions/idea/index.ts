import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isActiveMember } from '../shared/profile';
import { profileJson } from '../shared/profile-json';

interface IdeaRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
  [key: string]: unknown;
}

export default endpoint('idea', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown };
  const { ideaId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  const idea = await queryOne<IdeaRow>(`
    SELECT i.*,
      ${profileJson('pr')} AS profile,
      json_build_object('id', o.id, 'name', o.name) AS organization,
      (SELECT count(*)::int FROM idea_comments c WHERE c.idea_id = i.id) AS comment_count,
      (SELECT count(*)::int FROM idea_votes v WHERE v.idea_id = i.id) AS vote_count,
      EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = $2) AS user_has_voted
    FROM ideas i
    JOIN profiles pr ON pr.id = i.user_id
    JOIN organizations o ON o.id = i.org_id
    WHERE i.id = $1
  `, [ideaId, profile.id]);

  // Not found → null (parity with Supabase .single() PGRST116)
  if (!idea) return reply(200, { idea: null });

  // Org access: platform admin OR active member of the idea's org
  const canAccessOrg = profile.is_platform_admin || await isActiveMember(profile.id, idea.org_id);
  if (!canAccessOrg) return reply(200, { idea: null });

  // Draft privacy: drafts are author-private for EVERY role (no admin bypass).
  if (idea.status === 'draft' && idea.user_id !== profile.id) {
    return reply(200, { idea: null });
  }

  return reply(200, { idea });
});
