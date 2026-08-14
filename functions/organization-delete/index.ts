import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { cleanupBlobs } from '../shared/blob';
import { releasablePaths } from '../shared/blob-ownership';

interface OrgRow {
  id: string;
  logo_url: string | null;
}

export default endpoint('organization-delete', async ({ req, reply, requirePlatformAdmin }) => {
  const body = await req.json() as { orgId?: unknown };
  const { orgId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  requirePlatformAdmin();

  const deleted = await queryOne<OrgRow>(
    `DELETE FROM organizations WHERE id = $1 RETURNING id, logo_url`,
    [orgId],
  );
  if (!deleted) return reply(404, { error: 'Organization not found' });

  const paths = await releasablePaths([deleted.logo_url], 'org-logo');

  const { blobsDeleted, blobsFailed } = await cleanupBlobs(paths, 'organization-delete', orgId);

  return reply(200, { ok: true, blobsDeleted, blobsFailed });
});
