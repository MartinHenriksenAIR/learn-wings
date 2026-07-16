import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

interface ResourceRow {
  id: string;
  org_id: string;
  user_id: string;
}

export default endpoint('resource-delete', async ({ req, profile, reply }) => {
  const body = await req.json() as { resourceId?: unknown };
  const { resourceId } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return reply(400, { error: 'resourceId is required' });
  }

  const resource = await queryOne<ResourceRow>(
    `SELECT id, org_id, user_id FROM community_resources WHERE id = $1`,
    [resourceId],
  );
  if (!resource) return reply(404, { error: 'Resource not found' });

  // Authorization (OR of RLS DELETE policies, provenance 20260202125517):
  //   - platform admin (suite convention)
  //   - author of the resource
  //   - org admin of the resource's org
  let authorized = false;
  if (profile.is_platform_admin) {
    authorized = true;
  } else if (resource.user_id === profile.id) {
    authorized = true;
  } else if (await isOrgAdmin(profile.id, resource.org_id)) {
    authorized = true;
  }
  // Returning 404 here keeps an authenticated caller from distinguishing
  // "exists but I'm not allowed" from "doesn't exist" — prevents
  // cross-org enumeration of resource IDs.
  if (!authorized) return reply(404, { error: 'Resource not found' });

  await query(`DELETE FROM community_resources WHERE id = $1`, [resourceId]);

  return reply(200, { ok: true });
});
