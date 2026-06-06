import { generateSasToken, buildBlobUrl } from './sas';

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
