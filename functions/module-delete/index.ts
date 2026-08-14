import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { cleanupBlobs } from '../shared/blob';
import { releasablePaths } from '../shared/blob-ownership';

export default adminEndpoint('module-delete', async ({ req, reply }) => {
  const body = await req.json() as { moduleId?: unknown };
  const { moduleId } = body;

  if (!moduleId || typeof moduleId !== 'string') {
    return reply(400, { error: 'moduleId is required' });
  }

  const blobRows = await query<{
    video_storage_path: string | null;
    azure_blob_path: string | null;
    document_storage_path: string | null;
  }>(
    `SELECT video_storage_path, azure_blob_path, document_storage_path
       FROM lessons
      WHERE module_id = $1
        AND (video_storage_path IS NOT NULL
          OR azure_blob_path IS NOT NULL
          OR document_storage_path IS NOT NULL)`,
    [moduleId],
  );

  const deleted = await queryOne(
    `DELETE FROM course_modules WHERE id = $1 RETURNING id`,
    [moduleId],
  );

  if (!deleted) {
    return reply(404, { error: 'Module not found' });
  }

  const paths = await releasablePaths(
    blobRows.flatMap((r) => [r.video_storage_path, r.azure_blob_path, r.document_storage_path]),
    'lms',
  );

  const { blobsDeleted, blobsFailed } = await cleanupBlobs(paths, 'module-delete', moduleId);

  return reply(200, { success: true, blobsDeleted, blobsFailed });
});
