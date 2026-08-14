import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { RESOURCE_PROFILE_PROJECTION, RESOURCE_TYPES } from '../shared/resources';
import { validateHttpUrl } from '../shared/validate';

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
  const urlError = validateHttpUrl(url, 'url');
  if (urlError) {
    return reply(400, { error: urlError });
  }
  if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
    return reply(400, { error: 'tags must be an array of strings' });
  }

  await requireActiveMember(orgId);

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
