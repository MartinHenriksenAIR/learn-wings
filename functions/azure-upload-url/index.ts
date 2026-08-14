import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { endpoint } from '../shared/endpoint';
import { resolveAssetContainer, isBrandingAssetType } from '../shared/blob';
import { fileExtension, resolveUploadKind } from '../shared/upload-limits';

export default endpoint('azure-upload-url', async ({ req, reply, requirePlatformAdmin }) => {
  const { fileName, contentType: reqContentType, assetType } = await req.json() as { fileName: string; contentType?: string; assetType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  if (!isBrandingAssetType(assetType)) {
    requirePlatformAdmin();
  }

  const kind = resolveUploadKind(fileName, reqContentType);
  if (!kind) {
    return reply(400, { error: 'File type not allowed' });
  }
  if (isBrandingAssetType(assetType) && kind !== 'image') {
    return reply(400, { error: 'File type not allowed' });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  if (!accountName || !accountKey) {
    return reply(500, { error: 'Azure storage not configured' });
  }

  const { container: containerName, prefix } = resolveAssetContainer(assetType);

  const blobPath = `${prefix}${crypto.randomUUID()}.${fileExtension(fileName)}`;
  const contentType = reqContentType ?? 'application/octet-stream';

  const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

  return reply(200, { uploadUrl, blobPath, contentType });
});
