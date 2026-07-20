import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { adminEndpoint } from '../shared/endpoint';
import { resolveAssetContainer } from '../shared/blob';

export default adminEndpoint('azure-upload-url', async ({ req, reply }) => {
  const { fileName, contentType: reqContentType, assetType } = await req.json() as { fileName: string; contentType?: string; assetType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

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
}, { forbiddenError: 'Only platform admins can upload videos' });
