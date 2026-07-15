import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('azure-document-upload-url', async ({ req, reply }) => {
  const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  const ext = fileName.split('.').pop() ?? 'pdf';
  const uniqueName = `documents/${crypto.randomUUID()}.${ext}`;
  const contentType = reqContentType ?? 'application/pdf';

  const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

  return reply(200, { uploadUrl, blobPath: uniqueName, contentType });
});
