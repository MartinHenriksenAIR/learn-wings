import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';
import { deleteBlob } from '../shared/blob';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    const body = await req.json() as { moduleId?: unknown };
    const { moduleId } = body;

    if (!moduleId || typeof moduleId !== 'string') {
      return corsResponse(origin, 400, { error: 'moduleId is required' });
    }

    // Collect descendant blob paths before deletion.
    // Intentionally not transactional — blob deletes are irreversible and cannot join a DB
    // transaction; the tiny race window (lesson created between SELECT and DELETE) is acceptable
    // for an admin tool.
    const blobRows = await query<{ azure_blob_path: string }>(
      `SELECT azure_blob_path
         FROM lessons
        WHERE module_id = $1
          AND azure_blob_path IS NOT NULL`,
      [moduleId],
    );

    const deleted = await queryOne(
      `DELETE FROM course_modules WHERE id = $1 RETURNING id`,
      [moduleId],
    );

    if (!deleted) {
      return corsResponse(origin, 404, { error: 'Module not found' });
    }

    // Best-effort blob cleanup — deleteBlob never throws; it warns server-side per failed path,
    // and counts are returned to the client.
    const blobPaths = blobRows.map((r) => r.azure_blob_path);
    const results = await Promise.all(blobPaths.map((p) => deleteBlob(p)));
    const blobsDeleted = results.filter(Boolean).length;
    const blobsFailed = results.length - blobsDeleted;
    if (blobsFailed > 0) {
      console.warn(`[module-delete] ${blobsFailed} blob(s) failed to delete for module`, moduleId);
    }

    return corsResponse(origin, 200, { success: true, blobsDeleted, blobsFailed });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('module-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
