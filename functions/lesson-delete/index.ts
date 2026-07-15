import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';

export default adminEndpoint('lesson-delete', async ({ req, reply }) => {
    const body = await req.json() as { lessonId?: unknown };
    const { lessonId } = body;

    if (!lessonId || typeof lessonId !== 'string') {
      return reply(400, { error: 'lessonId is required' });
    }

    // Step 1: Delete the row first and retrieve the blob path in one statement (no separate SELECT).
    // Row-first ordering: if the DB fails here, no irreversible blob delete has happened yet.
    const deleted = await queryOne<{ id: string; azure_blob_path: string | null }>(
      `DELETE FROM lessons WHERE id = $1 RETURNING id, azure_blob_path`,
      [lessonId],
    );

    if (!deleted) {
      return reply(404, { error: 'Lesson not found' });
    }

    // Step 2: Delete the blob only after the row is gone.
    // blobDeleted is null when the lesson had no video — distinct from a real failure (false).
    let blobDeleted: boolean | null = null;
    if (deleted.azure_blob_path) {
      blobDeleted = await deleteBlob(deleted.azure_blob_path);
    }

    return reply(200, { success: true, blobDeleted });
});
