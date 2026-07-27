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

  // Authorization: platform-admin-only.
  // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-272 —
  // "Platform admins can do everything with orgs" was the only DELETE-capable policy.
  requirePlatformAdmin();

  // `logo_url` rides the DELETE rather than a separate SELECT — it lives on the row
  // being removed, so RETURNING it is both cheaper and race-free. Nothing collected
  // it before (#285), so every deleted org's logo sat in storage until the nightly
  // sweep's 24h grace expired. `organizations` is the only blob-holding table an
  // org delete cascades into: `courses` has no org_id and `profiles` are not
  // org-owned (membership is a join table), so this one column is the whole surface.
  const deleted = await queryOne<OrgRow>(
    `DELETE FROM organizations WHERE id = $1 RETURNING id, logo_url`,
    [orgId],
  );
  if (!deleted) return reply(404, { error: 'Organization not found' });

  // The release gate runs AFTER the DELETE, and that ordering is the point: this
  // org's row is gone, so a path still coming back referenced belongs to a DIFFERENT
  // row and must survive. The bind gate (`assertBindablePaths` in organization-update)
  // means new shared state can no longer be created, but production ran without it,
  // so a pre-existing shared logo was destroyable on the first delete touching it.
  //
  // It also fails SAFE — a reference query that throws deletes nothing and still
  // returns 200 — and drops an absolute external `logo_url`, which `classifyBlobPath`
  // calls `external` rather than `own` because it names no blob we could address.
  const paths = await releasablePaths([deleted.logo_url], 'org-logo');

  const { blobsDeleted, blobsFailed } = await cleanupBlobs(paths, 'organization-delete', orgId);

  return reply(200, { ok: true, blobsDeleted, blobsFailed });
});
