import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-settings-update', async ({ req, profile, reply, requireOrgAdmin }) => {
  const { orgId, features } = await req.json() as { orgId?: unknown; features?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  if (features === null || typeof features !== 'object' || Array.isArray(features)) {
    return reply(400, { error: 'features must be a plain object' });
  }

  await requireOrgAdmin(orgId);

  // updated_at is managed by a DB trigger on UPDATE; updated_by is the authenticated caller's profile id.
  // JSON.stringify is deliberate, not required: pg would auto-stringify a plain object, but explicit
  // serialization sidesteps pg's array-vs-jsonb param footgun if the features guard ever loosens.
  const settings = await queryOne(
    `INSERT INTO org_settings (org_id, features, updated_by)
VALUES ($1, $2, $3)
ON CONFLICT (org_id) DO UPDATE SET features = EXCLUDED.features, updated_by = EXCLUDED.updated_by
RETURNING org_id, features`,
    [orgId, JSON.stringify(features), profile.id],
  );

  return reply(200, { settings });
});
