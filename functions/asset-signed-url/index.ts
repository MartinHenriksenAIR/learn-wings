import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { authenticate, AuthError } from '../shared/auth';
import { getProfile } from '../shared/profile';
import { canAccessLmsAsset } from '../shared/lms-asset';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { blobPath?: unknown };
    const { blobPath } = body;
    if (!blobPath || typeof blobPath !== 'string') {
      return corsResponse(origin, 400, { error: 'blobPath is required' });
    }

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
    const url = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return corsResponse(origin, 200, { url });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('asset-signed-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
