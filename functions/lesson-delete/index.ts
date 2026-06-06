import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';
import { generateSasToken, buildBlobUrl } from '../shared/sas';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    const body = await req.json() as { lessonId?: unknown };
    const { lessonId } = body;

    if (!lessonId || typeof lessonId !== 'string') {
      return corsResponse(origin, 400, { error: 'lessonId is required' }) as HttpResponseInit;
    }

    // Step 1: Fetch lesson to get azure_blob_path (also confirms existence)
    const lessonRow = await queryOne<{ azure_blob_path: string | null }>(
      `SELECT azure_blob_path FROM lessons WHERE id = $1`,
      [lessonId],
    );

    if (!lessonRow) {
      return corsResponse(origin, 404, { error: 'Lesson not found' }) as HttpResponseInit;
    }

    // Step 2: Delete the blob if present (failure must NOT abort — old swallow-and-continue parity)
    let blobDeleted = false;
    if (lessonRow.azure_blob_path) {
      const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

      if (!accountName || !accountKey) {
        console.warn('[lesson-delete] Missing storage env vars — skipping blob delete for', lessonRow.azure_blob_path);
      } else {
        try {
          const sasToken = generateSasToken(accountName, accountKey, containerName, lessonRow.azure_blob_path, 'd', 10);
          const deleteUrl = buildBlobUrl(accountName, containerName, lessonRow.azure_blob_path, sasToken);
          const res = await fetch(deleteUrl, { method: 'DELETE' });
          if (res.ok) {
            blobDeleted = true;
          } else {
            console.warn(`[lesson-delete] Blob delete returned non-2xx ${res.status} for`, lessonRow.azure_blob_path);
          }
        } catch (blobErr: unknown) {
          console.warn('[lesson-delete] Blob delete failed (continuing):', blobErr instanceof Error ? blobErr.message : blobErr);
        }
      }
    }

    // Step 3: Delete the row
    const deleted = await queryOne(
      `DELETE FROM lessons WHERE id = $1 RETURNING id`,
      [lessonId],
    );

    if (!deleted) {
      // Race condition — row already gone
      return corsResponse(origin, 404, { error: 'Lesson not found' }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { success: true, blobDeleted }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('lesson-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
