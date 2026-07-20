import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { endpoint } from '../shared/endpoint';
import { resolveAssetContainer, isBrandingAssetType } from '../shared/blob';

export default endpoint('azure-upload-url', async ({ req, reply, requirePlatformAdmin }) => {
  const { fileName, contentType: reqContentType, assetType } = await req.json() as { fileName: string; contentType?: string; assetType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  // Branding uploads (org logos, avatars) are open to any authenticated user:
  // the blob is inert until its path is persisted, and that step is separately
  // authorized (organization-update requires org admin for logo_url; profile-
  // update writes only the caller's own avatar_url). Every other upload targets
  // the course-content container and remains platform-admin only.
  if (!isBrandingAssetType(assetType)) {
    requirePlatformAdmin();
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  if (!accountName || !accountKey) {
    return reply(500, { error: 'Azure storage not configured' });
  }

  const { container: containerName, prefix } = resolveAssetContainer(assetType);

  const ext = fileName.split('.').pop() ?? '';
  const blobPath = `${prefix}${crypto.randomUUID()}.${ext}`;
  const contentType = reqContentType ?? 'application/octet-stream';

  const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

  return reply(200, { uploadUrl, blobPath, contentType });
});
