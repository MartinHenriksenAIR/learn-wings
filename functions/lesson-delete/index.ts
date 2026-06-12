import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { requirePlatformAdmin } from '../shared/guards';
import { deleteBlob } from '../shared/blob';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;

    const body = await req.json() as { lessonId?: unknown };
    const { lessonId } = body;

    if (!lessonId || typeof lessonId !== 'string') {
      return corsResponse(origin, 400, { error: 'lessonId is required' });
    }

    // Step 1: Delete the row first and retrieve the blob path in one statement (no separate SELECT).
    // Row-first ordering: if the DB fails here, no irreversible blob delete has happened yet.
    const deleted = await queryOne<{ id: string; azure_blob_path: string | null }>(
      `DELETE FROM lessons WHERE id = $1 RETURNING id, azure_blob_path`,
      [lessonId],
    );

    if (!deleted) {
      return corsResponse(origin, 404, { error: 'Lesson not found' });
    }

    // Step 2: Delete the blob only after the row is gone.
    // blobDeleted is null when the lesson had no video — distinct from a real failure (false).
    let blobDeleted: boolean | null = null;
    if (deleted.azure_blob_path) {
      blobDeleted = await deleteBlob(deleted.azure_blob_path);
    }

    return corsResponse(origin, 200, { success: true, blobDeleted });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('lesson-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
