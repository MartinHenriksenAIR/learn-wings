import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { adminEndpoint } from '../shared/endpoint';
import { fileExtension, resolveUploadKind } from '../shared/upload-limits';
import { mintReleaseToken } from '../shared/release-token';

export default adminEndpoint('azure-document-upload-url', async ({ req, profile, reply }) => {
  const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  if (resolveUploadKind(fileName, reqContentType) !== 'document') {
    return reply(400, { error: 'File type not allowed' });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  const uniqueName = `documents/${crypto.randomUUID()}.${fileExtension(fileName)}`;
  const contentType = reqContentType ?? 'application/pdf';

  const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

  return reply(200, { uploadUrl, blobPath: uniqueName, contentType, releaseToken: mintReleaseToken(uniqueName, profile.id) });
});
