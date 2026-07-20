import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { endpoint } from '../shared/endpoint';
import { isBrandingAssetPath } from '../shared/blob';

/**
 * Mints a short-lived (120 min) read SAS URL for a branding asset (org logo /
 * avatar) stored in the private default container.
 *
 * Any authenticated user may view branding assets — they are non-sensitive and
 * shown across the app (member lists, sidebar, org pages). The ONLY gate is the
 * strict branding-path check: without it this endpoint could be coerced into
 * signing arbitrary private course-content blobs that share the container.
 * (This is deliberately separate from asset-signed-url, whose canAccessLmsAsset
 * authz would reject non-lesson paths like these.)
 */
export default endpoint('branding-asset-url', async ({ req, reply }) => {
  const body = await req.json() as { blobPath?: unknown };
  const { blobPath } = body;
  if (!blobPath || typeof blobPath !== 'string') {
    return reply(400, { error: 'blobPath is required' });
  }
  if (!isBrandingAssetPath(blobPath)) {
    return reply(400, { error: 'Not a branding asset path' });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  if (!accountName || !accountKey) {
    return reply(500, { error: 'Azure storage not configured' });
  }
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
  const url = buildBlobUrl(accountName, containerName, blobPath, sasToken);

  return reply(200, { url });
});
