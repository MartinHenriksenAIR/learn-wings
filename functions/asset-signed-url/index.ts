import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';
import { getProfile } from '../shared/profile';

async function canAccessAsset(profileId: string, blobPath: string): Promise<boolean> {
  const result = await queryOne<{ can_access: boolean }>(
    `SELECT (
      EXISTS (
        SELECT 1 FROM lessons l
        JOIN course_modules cm ON cm.id = l.module_id
        JOIN courses c ON c.id = cm.course_id
        JOIN org_course_access oca ON oca.course_id = c.id
        JOIN org_memberships om ON om.org_id = oca.org_id
        WHERE c.is_published = TRUE AND oca.access = 'enabled'
          AND om.user_id = $1 AND om.status = 'active'
          AND (l.video_storage_path = $2 OR l.document_storage_path = $2)
      )
      OR EXISTS (
        SELECT 1 FROM courses c
        JOIN org_course_access oca ON oca.course_id = c.id
        JOIN org_memberships om ON om.org_id = oca.org_id
        WHERE c.is_published = TRUE AND oca.access = 'enabled'
          AND om.user_id = $1 AND om.status = 'active'
          AND c.thumbnail_url = $2
      )
    ) AS can_access`,
    [profileId, blobPath]
  );
  return result?.can_access ?? false;
}

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

    // Access check — short-circuit for platform admins; otherwise check org membership + thumbnail access
    if (!profile.is_platform_admin) {
      const hasAccess = await canAccessAsset(profile.id, blobPath);
      if (!hasAccess) return corsResponse(origin, 403, { error: 'Access denied' });
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
    const url = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return corsResponse(origin, 200, { url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('token') || msg.includes('Token')) return corsResponse(origin, 401, { error: msg });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('asset-signed-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
