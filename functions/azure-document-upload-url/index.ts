import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { adminEndpoint } from '../shared/endpoint';
import { fileExtension, resolveUploadKind } from '../shared/upload-limits';

export default adminEndpoint('azure-document-upload-url', async ({ req, reply }) => {
  const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
  if (!fileName) return reply(400, { error: 'fileName is required' });

  // Allow-list the DECLARED extension + content type (#276). Defence in depth
  // only — the client PUTs whatever bytes it likes to the URL we hand back, so
  // the binding check is the post-upload HEAD at persist time
  // (`enforceUploadLimits` in lesson-create/lesson-update). Unlike
  // `azure-upload-url`, this endpoint has exactly one purpose, so the kind is
  // pinned rather than inferred: a video or an image minted here would land under
  // the documents/ prefix and be measured against the wrong cap.
  if (resolveUploadKind(fileName, reqContentType) !== 'document') {
    return reply(400, { error: 'File type not allowed' });
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  // The allow-listed extension rather than a raw `split('.').pop()`: it is
  // already normalized to lower-case alphanumerics, so the minted path can never
  // inherit whatever the caller put after the last dot.
  const uniqueName = `documents/${crypto.randomUUID()}.${fileExtension(fileName)}`;
  const contentType = reqContentType ?? 'application/pdf';

  const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
  const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

  return reply(200, { uploadUrl, blobPath: uniqueName, contentType });
});
