import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { generateSasToken, buildBlobUrl } from '../shared/sas';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { queryOne } from '../shared/db';
import { authenticate } from '../shared/auth';

async function canAccessAsset(userId: string, filePath: string): Promise<boolean> {
  const result = await queryOne<{ can_access: boolean }>(
    `SELECT (
      EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND is_platform_admin = TRUE)
      OR EXISTS (
        SELECT 1 FROM lessons l
        JOIN course_modules cm ON cm.id = l.module_id
        JOIN courses c ON c.id = cm.course_id
        JOIN org_course_access oca ON oca.course_id = c.id
        JOIN org_memberships om ON om.org_id = oca.org_id
        WHERE c.is_published = TRUE AND oca.access = 'enabled'
          AND om.user_id = $1 AND om.status = 'active'
          AND (l.video_storage_path = $2 OR l.document_storage_path = $2)
      )
    ) AS can_access`,
    [userId, filePath]
  );
  return result?.can_access ?? false;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = await authenticate(req);
    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' }) as HttpResponseInit;

    const hasAccess = await canAccessAsset(user.id, blobPath);
    if (!hasAccess) return corsResponse(origin, 403, { error: 'Access denied' }) as HttpResponseInit;

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME!;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY!;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 120);
    const viewUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);

    return corsResponse(origin, 200, { viewUrl }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-view-url', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
