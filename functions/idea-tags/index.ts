import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('idea-tags', async ({ req, profile, reply, requireActiveMember }) => {
    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    // Authorization: platform admin OR active member of the org
    await requireActiveMember(orgId);

    // Distinct, non-empty tags from the org's ideas that are VISIBLE to the caller
    // (drafts are author-private). $1 = orgId, $2 = caller profile id.
    const rows = await query<{ tag: string }>(`
      SELECT DISTINCT unnest(tags) AS tag
      FROM ideas
      WHERE org_id = $1
        AND (status <> 'draft' OR user_id = $2)
        AND tags IS NOT NULL
      ORDER BY tag ASC
    `, [orgId, profile.id]);

    const tags = rows
      .map((r) => r.tag)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);

    return reply(200, { tags });
});
