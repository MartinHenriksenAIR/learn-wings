import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { cleanupBlobs } from '../shared/blob';
import { releasablePaths } from '../shared/blob-ownership';

export default adminEndpoint('course-delete', async ({ req, reply }) => {
  const body = await req.json() as { courseId?: unknown };
  const { courseId } = body;

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  const blobRows = await query<{
    video_storage_path: string | null;
    azure_blob_path: string | null;
    document_storage_path: string | null;
  }>(
    `SELECT l.video_storage_path, l.azure_blob_path, l.document_storage_path
       FROM lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE m.course_id = $1
        AND (l.video_storage_path IS NOT NULL
          OR l.azure_blob_path IS NOT NULL
          OR l.document_storage_path IS NOT NULL)`,
    [courseId],
  );

  const deleted = await queryOne<{ id: string; thumbnail_url: string | null }>(
    `DELETE FROM courses WHERE id = $1 RETURNING id, thumbnail_url`,
    [courseId],
  );

  if (!deleted) return reply(404, { error: 'Course not found' });

  const paths = await releasablePaths(
    [
      ...blobRows.flatMap((r) => [r.video_storage_path, r.azure_blob_path, r.document_storage_path]),
      deleted.thumbnail_url,
    ],
    'lms',
  );

  const { blobsDeleted, blobsFailed } = await cleanupBlobs(paths, 'course-delete', courseId);

  return reply(200, { success: true, blobsDeleted, blobsFailed });
});
