import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('idea-vote-remove', async ({ req, profile, reply }) => {
  const body = await req.json() as { ideaId?: unknown };
  const { ideaId } = body;

  if (!ideaId || typeof ideaId !== 'string') {
    return reply(400, { error: 'ideaId is required' });
  }

  // Blind delete — no idea load; idempotent (parity with old client blind-delete)
  await query(
    `DELETE FROM idea_votes WHERE idea_id = $1 AND user_id = $2`,
    [ideaId, profile.id],
  );

  return reply(200, { ok: true });
});
