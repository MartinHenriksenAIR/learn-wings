import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { requirePlatformAdmin } from '../shared/guards';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const gate = await requirePlatformAdmin(req, origin, {
      forbiddenError: 'Only platform admins can upload videos',
    });
    if (!gate.ok) return gate.response;

    const { fileName, contentType: reqContentType } = await req.json() as { fileName: string; contentType?: string };
    if (!fileName) return corsResponse(origin, 400, { error: 'fileName is required' });

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';
    if (!accountName || !accountKey) {
      return corsResponse(origin, 500, { error: 'Azure storage not configured' });
    }

    const ext = fileName.split('.').pop() ?? '';
    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const contentType = reqContentType ?? 'application/octet-stream';

    const sasToken = generateSasToken(accountName, accountKey, containerName, uniqueName, 'cw', 30);
    const uploadUrl = buildBlobUrl(accountName, containerName, uniqueName, sasToken);

    return corsResponse(origin, 200, { uploadUrl, blobPath: uniqueName, contentType });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('token') || msg.includes('Token')) return corsResponse(origin, 401, { error: msg });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('azure-upload-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
