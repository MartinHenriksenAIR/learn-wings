import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { RESOURCE_PROFILE_PROJECTION } from '../shared/resources';

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export default endpoint('resources', async ({ req, reply, requireActiveMember }) => {
  const body = await req.json() as {
    orgId?: unknown;
    search?: unknown;
    resource_type?: unknown;
    tags?: unknown;
  };

  const { orgId, search, resource_type, tags } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (search !== undefined && typeof search !== 'string') {
    return reply(400, { error: 'search must be a string' });
  }
  if (resource_type !== undefined && typeof resource_type !== 'string') {
    return reply(400, { error: 'resource_type must be a string' });
  }
  if (tags !== undefined && !isStringArray(tags)) {
    return reply(400, { error: 'tags must be an array of strings' });
  }

  // Authorization: platform admin OR active member of the org
  await requireActiveMember(orgId);

  const conditions: string[] = [];
  const params: unknown[] = [];

  params.push(orgId);
  conditions.push(`r.org_id = $${params.length}`);

  if (resource_type) {
    params.push(resource_type);
    conditions.push(`r.resource_type = $${params.length}`);
  }

  if (tags && tags.length > 0) {
    params.push(tags);
    conditions.push(`r.tags && $${params.length}::text[]`);
  }

  if (search) {
    // Escape LIKE metacharacters so user input like "100%" or "snake_case"
    // is treated as a literal substring rather than a wildcard.
    const escaped = search.replace(/[\\%_]/g, '\\$&');
    params.push(`%${escaped}%`);
    const n = params.length;
    conditions.push(`(r.title ILIKE $${n} OR r.description ILIKE $${n})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const resources = await query(`
    SELECT r.*,
      ${RESOURCE_PROFILE_PROJECTION}
    FROM community_resources r
    LEFT JOIN profiles pr ON pr.id = r.user_id
    ${where}
    ORDER BY r.is_pinned DESC, r.created_at DESC
  `, params);

  // Distinct tags for the org, regardless of search/type/tag filters — powers the tag dropdown.
  const tagsRow = await queryOne<{ all_tags: string[] }>(
    `SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), '{}'::text[]) AS all_tags
     FROM community_resources r, unnest(r.tags) AS t
     WHERE r.org_id = $1`,
    [orgId],
  );

  return reply(200, { resources, allTags: tagsRow?.all_tags ?? [] });
});
