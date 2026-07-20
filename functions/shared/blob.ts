import { generateSasToken, buildBlobUrl } from './sas';

/** The public Azure Blob container (ADR-0008) used for branding assets that must be viewable without a SAS token. */
export const PUBLIC_CONTAINER = 'email-assets';

/**
 * Resolves a client-declared upload `assetType` to a container + folder prefix.
 *
 * The client only ever declares intent (`assetType`); this hardcoded allow-list is the
 * sole place that maps intent to a container, so the client can never target an
 * arbitrary container. An absent or unrecognized `assetType` falls through to the
 * existing private default — this is intentionally not an error: the enum is an
 * allow-list, not a validated input.
 */
export function resolveAssetContainer(assetType?: string): { container: string; prefix: string } {
  switch (assetType) {
    case 'org-logo':
      return { container: PUBLIC_CONTAINER, prefix: 'org-logos/' };
    case 'avatar':
      return { container: PUBLIC_CONTAINER, prefix: 'avatars/' };
    default:
      return { container: process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos', prefix: '' };
  }
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
