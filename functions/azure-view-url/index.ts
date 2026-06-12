import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { authenticate } from '../shared/auth';
import { getProfile } from '../shared/profile';
import { canAccessLmsAsset } from '../shared/lms-asset';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' });

    // Access check — short-circuit for platform admins; otherwise the shared
    // can_user_access_lms_asset parity predicate (lesson asset columns + thumbnail).
    if (!profile.is_platform_admin) {
      const hasAccess = await canAccessLmsAsset(profile.id, blobPath);
      if (!hasAccess) return corsResponse(origin, 403, { error: 'Access denied' });
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
    const viewUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return corsResponse(origin, 200, { viewUrl });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('token') || msg.includes('Token')) return corsResponse(origin, 401, { error: msg });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('azure-view-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
