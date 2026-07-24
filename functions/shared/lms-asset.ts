import { queryOne } from './db';
import { generateSasToken, buildBlobUrl } from './sas';
import type { CallerProfile } from './profile';

/**
 * TS port of the canonical authz rule public.can_user_access_lms_asset
 * (migration/azure/01-schema.sql) — the ONE place the LMS-asset predicate
 * lives. Before this module, azure-view-url and asset-signed-url carried
 * hand-inlined copies that drifted in complementary directions (azure-view-url
 * lost the thumbnail branch; asset-signed-url lost azure_blob_path — the bug
 * class issue #14 fixed). See issue #60.
 *
 * Parity notes vs the SQL function:
 * - The RPC's first EXISTS (profiles.is_platform_admin) is NOT ported here —
 *   platform admin stays a TS short-circuit at the endpoint level, per suite
 *   convention (endpoints skip the query entirely for platform admins).
 * - Lesson branch matches ALL THREE asset-path columns (video_storage_path,
 *   document_storage_path, azure_blob_path) + the thumbnail branch matches
 *   courses.thumbnail_url. $1 = profile id, $2 = blob path.
 */
export const CAN_ACCESS_LMS_ASSET_SQL = `SELECT (
  EXISTS (
    SELECT 1 FROM lessons l
    JOIN course_modules cm ON cm.id = l.module_id
    JOIN courses c ON c.id = cm.course_id
    JOIN org_course_access oca ON oca.course_id = c.id
    JOIN org_memberships om ON om.org_id = oca.org_id
    WHERE c.is_published = TRUE AND oca.access = 'enabled'
      AND om.user_id = $1 AND om.status = 'active'
      AND (l.video_storage_path = $2 OR l.document_storage_path = $2 OR l.azure_blob_path = $2)
  )
  OR EXISTS (
    SELECT 1 FROM courses c
    JOIN org_course_access oca ON oca.course_id = c.id
    JOIN org_memberships om ON om.org_id = oca.org_id
    WHERE c.is_published = TRUE AND oca.access = 'enabled'
      AND om.user_id = $1 AND om.status = 'active'
      AND c.thumbnail_url = $2
  )
) AS can_access`;

/**
 * Can this (non-platform-admin) profile access the LMS asset at blobPath?
 * True when an active org membership reaches a published, org-enabled course
 * that references the path via a lesson asset column or its thumbnail.
 */
export async function canAccessLmsAsset(profileId: string, blobPath: string): Promise<boolean> {
  const result = await queryOne<{ can_access: boolean }>(
    CAN_ACCESS_LMS_ASSET_SQL,
    [profileId, blobPath],
  );
  return result?.can_access ?? false;
}

/**
 * Tagged result returned by mintLmsAssetUrl — lets thin endpoint wrappers
 * dispatch to their own reply() without importing Reply from endpoint.ts.
 */
export type MintResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Shared core for asset-signed-url and azure-view-url (#239):
 *   validate blobPath (strict typeof — the ONE sanctioned behaviour change vs the
 *   old azure-view-url truthiness check) → platform-admin short-circuit → authz
 *   gate via canAccessLmsAsset → mint 120-min read SAS → build blob URL.
 *
 * Env vars read lazily here (not at module load) per functions.md.
 * Returns a tagged MintResult; callers map ok:false → reply(status, {error}).
 */
export async function mintLmsAssetUrl(
  profile: CallerProfile,
  blobPath: unknown,
): Promise<MintResult> {
  if (!blobPath || typeof blobPath !== 'string') {
    return { ok: false, status: 400, error: 'blobPath is required' };
  }

  if (!profile.is_platform_admin) {
    const hasAccess = await canAccessLmsAsset(profile.id, blobPath);
    if (!hasAccess) return { ok: false, status: 403, error: 'Access denied' };
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
  const url = buildBlobUrl(accountName, containerName, blobPath, sasToken);

  return { ok: true, url };
}
