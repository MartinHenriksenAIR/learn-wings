import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { authenticate } from '../shared/auth';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);

    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });
    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Only platform admins can upload videos' });
    }

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
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg });
  }
}

export default handler;
app.http('azure-upload-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
