import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import {
  RESOURCE_PROFILE_PROJECTION, RESOURCE_TYPES, loadResourceForWrite,
} from '../shared/resources';
import { buildUpdateSet } from '../shared/update-builder';
import { validateHttpUrl } from '../shared/validate';

const ALLOWED_UPDATE_FIELDS = new Set([
  'title', 'description', 'resource_type', 'url', 'tags', 'is_pinned',
]);

export default endpoint('resource-update', async ({ req, profile, reply }) => {
  const body = await req.json() as { resourceId?: unknown; updates?: unknown };
  const { resourceId, updates } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return reply(400, { error: 'resourceId is required' });
  }

  const built = buildUpdateSet(updates, ALLOWED_UPDATE_FIELDS);
  if (!built.ok) {
    return reply(400, { error: built.error });
  }

  const updatesObj = updates as Record<string, unknown>;
  const updateKeys = Object.keys(updatesObj);
  for (const key of updateKeys) {
    const v = updatesObj[key];
    if (key === 'tags') {
      if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) {
        return reply(400, { error: 'tags must be an array of strings' });
      }
    } else if (key === 'is_pinned') {
      if (typeof v !== 'boolean') {
        return reply(400, { error: 'is_pinned must be a boolean' });
      }
    } else if (key === 'resource_type') {
      if (typeof v !== 'string' || !RESOURCE_TYPES.includes(v)) {
        return reply(400, {
          error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}`,
        });
      }
    } else if (key === 'title') {
      if (!v || typeof v !== 'string') {
        return reply(400, { error: 'title must be a non-empty string' });
      }
    } else if (key === 'url') {
      if (v !== null && typeof v !== 'string') {
        return reply(400, { error: 'url must be a string or null' });
      }
      const urlError = validateHttpUrl(v, 'url');
      if (urlError) {
        return reply(400, { error: urlError });
      }
    } else {
      if (v !== null && typeof v !== 'string') {
        return reply(400, { error: `${key} must be a string or null` });
      }
    }
  }

  const resource = await loadResourceForWrite(resourceId, profile);
  if (!resource) return reply(404, { error: 'Resource not found' });

  const { setClauses, params } = built;
  params.push(resourceId);
  const idIndex = params.length;

  const updated = await queryOne(
    `WITH upd AS (
      UPDATE community_resources SET ${setClauses.join(', ')}
      WHERE id = $${idIndex}
      RETURNING *
    )
    SELECT upd.*,
      ${RESOURCE_PROFILE_PROJECTION}
    FROM upd
    LEFT JOIN profiles pr ON pr.id = upd.user_id`,
    params,
  );

  return reply(200, { resource: updated });
});
