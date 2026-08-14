import { queryOne } from './db';
import { generateSasToken, buildBlobUrl } from './sas';
import type { CallerProfile } from './profile';

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

export async function canAccessLmsAsset(profileId: string, blobPath: string): Promise<boolean> {
  const result = await queryOne<{ can_access: boolean }>(
    CAN_ACCESS_LMS_ASSET_SQL,
    [profileId, blobPath],
  );
  return result?.can_access ?? false;
}

export type MintResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 403; error: string };

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
