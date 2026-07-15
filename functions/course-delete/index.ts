import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';

export default adminEndpoint('course-delete', async ({ req, reply }) => {
  const body = await req.json() as { courseId?: unknown };
  const { courseId } = body;

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  // Collect descendant blob paths before deletion.
  // Intentionally not transactional — blob deletes are irreversible and cannot join a DB
  // transaction; the tiny race window (lesson created between SELECT and DELETE) is acceptable
  // for an admin tool.
  const blobRows = await query<{ azure_blob_path: string }>(
    `SELECT l.azure_blob_path
       FROM lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE m.course_id = $1
        AND l.azure_blob_path IS NOT NULL`,
    [courseId],
  );

  const deleted = await queryOne<{ id: string }>(
    `DELETE FROM courses WHERE id = $1 RETURNING id`,
    [courseId],
  );

  if (!deleted) return reply(404, { error: 'Course not found' });

  // Best-effort blob cleanup — deleteBlob never throws; it warns server-side per failed path,
  // and counts are returned to the client.
  const blobPaths = blobRows.map((r) => r.azure_blob_path);
  const results = await Promise.all(blobPaths.map((p) => deleteBlob(p)));
  const blobsDeleted = results.filter(Boolean).length;
  const blobsFailed = results.length - blobsDeleted;
  if (blobsFailed > 0) {
    console.warn(`[course-delete] ${blobsFailed} blob(s) failed to delete for course`, courseId);
  }

  return reply(200, { success: true, blobsDeleted, blobsFailed });
});
