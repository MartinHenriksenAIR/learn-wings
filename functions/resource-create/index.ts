import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { RESOURCE_PROFILE_PROJECTION } from '../shared/resources';

// Mirrors RESOURCE_TYPES in src/lib/resources-api.ts. No DB CHECK constraint exists
// (the column is plain TEXT DEFAULT 'link'); validating here keeps types consistent
// with the form's <Select> options.
const RESOURCE_TYPES = ['link', 'document', 'template', 'guide'];

export default endpoint('resource-create', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as Record<string, unknown>;
  const { orgId, title, description, resource_type, url, tags } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!title || typeof title !== 'string') {
    return reply(400, { error: 'title is required' });
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return reply(400, { error: 'description must be a string' });
  }
  if (resource_type !== undefined && (typeof resource_type !== 'string' || !RESOURCE_TYPES.includes(resource_type))) {
    return reply(400, {
      error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}`,
    });
  }
  if (url !== undefined && url !== null && typeof url !== 'string') {
    return reply(400, { error: 'url must be a string' });
  }
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
    return reply(400, { error: 'tags must be an array of strings' });
  }

  // Authorization: platform admin OR active member of the org
  await requireActiveMember(orgId);

  // INSERT + LEFT JOIN profiles in one round trip so the response matches the
  // original lib's .select(`*, profile:profiles!fk(...)`) shape.
  // user_id is ALWAYS profile.id (never client-supplied).
  const resource = await queryOne(
    `WITH ins AS (
      INSERT INTO community_resources
        (org_id, user_id, title, description, resource_type, url, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    )
    SELECT ins.*,
      ${RESOURCE_PROFILE_PROJECTION}
    FROM ins
    LEFT JOIN profiles pr ON pr.id = ins.user_id`,
    [
      orgId,
      profile.id,
      title,
      (description as string | null | undefined) ?? null,
      (resource_type as string | undefined) ?? 'link',
      (url as string | null | undefined) ?? null,
      (tags as string[] | undefined) ?? [],
    ],
  );

  return reply(200, { resource });
});
