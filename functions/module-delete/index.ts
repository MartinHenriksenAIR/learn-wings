import { query, queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { deleteBlob } from '../shared/blob';

export default adminEndpoint('module-delete', async ({ req, reply }) => {
  const body = await req.json() as { moduleId?: unknown };
  const { moduleId } = body;

  if (!moduleId || typeof moduleId !== 'string') {
    return reply(400, { error: 'moduleId is required' });
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
    return reply(404, { error: 'Module not found' });
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

  return reply(200, { success: true, blobsDeleted, blobsFailed });
});
