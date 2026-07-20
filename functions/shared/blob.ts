import { generateSasToken, buildBlobUrl } from './sas';

/**
 * Client-uploadable branding asset types → their folder prefix within the
 * private default container. Branding assets (org logos, avatars) live in the
 * SAME private container as course content and are served via short-lived
 * signed URLs (see the branding-asset-url endpoint) — NOT anonymous public
 * access (the storage account has `allowBlobPublicAccess=false`).
 */
export const BRANDING_ASSET_PREFIXES: Record<string, string> = {
  'org-logo': 'org-logos/',
  'avatar': 'avatars/',
};

/** True if `assetType` is a client-uploadable branding asset (org logo / avatar). */
export function isBrandingAssetType(assetType?: string): boolean {
  return !!assetType && assetType in BRANDING_ASSET_PREFIXES;
}

/** True if a stored blob path is a branding asset — the sole gate the
 * branding-asset-url endpoint uses so it can never be coerced into signing an
 * arbitrary private course-content path. Prefix + a single flat filename only
 * (no nested slashes, no traversal). */
export function isBrandingAssetPath(blobPath: string): boolean {
  return /^(org-logos|avatars)\/[A-Za-z0-9._-]+$/.test(blobPath);
}

/**
 * Resolves a client-declared upload `assetType` to a container + folder prefix.
 *
 * The client only ever declares intent (`assetType`); this hardcoded allow-list is the
 * sole place that maps intent to a prefix, so the client can never target an
 * arbitrary path. Everything uploads to the private default container; branding
 * assets just get a folder prefix. An absent or unrecognized `assetType` gets no
 * prefix — intentionally not an error (the enum is an allow-list, not validated input).
 */
export function resolveAssetContainer(assetType?: string): { container: string; prefix: string } {
  return {
    container: process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos',
    prefix: (assetType && BRANDING_ASSET_PREFIXES[assetType]) ?? '',
  };
}

/**
 * Deletes a blob from Azure Blob Storage using a short-lived SAS token.
 *
 * Returns true  if the delete succeeded (2xx) or the blob was already gone (404).
 * Returns false for any other non-ok status, or if a network error occurs.
 * Never throws.
 */
export async function deleteBlob(blobPath: string): Promise<boolean> {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  if (!accountName || !accountKey) {
    console.warn('[deleteBlob] Missing storage env vars — skipping blob delete for', blobPath);
    return false;
  }

  try {
    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'd', 10);
    const deleteUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);
    const res = await fetch(deleteUrl, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      return true;
    }
    console.warn(`[deleteBlob] Storage returned ${res.status} for`, blobPath);
    return false;
  } catch (err: unknown) {
    console.warn('[deleteBlob] fetch failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
