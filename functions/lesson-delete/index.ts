import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';
import { releasablePaths } from '../shared/blob-ownership';

export default adminEndpoint('lesson-delete', async ({ req, reply }) => {
  const body = await req.json() as { lessonId?: unknown };
  const { lessonId } = body;

  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }

  const deleted = await queryOne<{
    id: string;
    video_storage_path: string | null;
    azure_blob_path: string | null;
    document_storage_path: string | null;
  }>(
    `DELETE FROM lessons WHERE id = $1 RETURNING id, video_storage_path, azure_blob_path, document_storage_path`,
    [lessonId],
  );

  if (!deleted) {
    return reply(404, { error: 'Lesson not found' });
  }

  const releasable = await releasablePaths(
    [deleted.video_storage_path, deleted.azure_blob_path, deleted.document_storage_path],
    'lms',
  );

  let blobDeleted: boolean | null = null;
  if (releasable.length > 0) {
    const results = await Promise.all(releasable.map((path) => deleteBlob(path)));
    blobDeleted = results.every(Boolean);
  }

  return reply(200, { success: true, blobDeleted });
});
