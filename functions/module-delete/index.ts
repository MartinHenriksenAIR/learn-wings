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

  // Collect descendant blob paths before deletion.
  // Intentionally not transactional — blob deletes are irreversible and cannot join a DB
  // transaction; the tiny race window (lesson created between SELECT and DELETE) is acceptable
  // for an admin tool.
  //
  // ALL THREE lesson blob columns (#280): collecting only azure_blob_path left
  // every document lesson's file and every Supabase-era video_storage_path behind
  // for the nightly sweep. `video_url` is deliberately absent — it is a deprecated
  // EXTERNAL url, never a blob path.
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

  // The release gate runs AFTER the DELETE, and that ordering is the whole point:
  // the lessons that referenced these paths are gone (ON DELETE CASCADE), so
  // anything still coming back referenced belongs to a DIFFERENT row and must
  // survive. The bind gate (`assertBindablePaths`) means new shared state can no
  // longer be created, but production ran without it, so a pre-existing shared
  // path was destroyable on the first cascade delete that touched it (#280).
  //
  // Placed HERE rather than inside `cleanupBlobs` deliberately. `blob.ts` is the
  // DB-free storage layer and `blob-ownership.ts` imports FROM it, so pushing the
  // gate down would make the two modules circular; `cleanupBlobs(paths)` also
  // carries no family, and the family is a property of the COLUMN the paths came
  // from, which only this endpoint knows. It would not even be the broader fix it
  // looks like: `deleteBlob` is called directly from six other places and
  // `cleanupBlobs` from exactly two. This is the same call-site shape the update
  // endpoints use, one round trip for the whole subtree.
  //
  // `releasablePaths` also drops nulls and collapses duplicates, so a path stored
  // in two columns of the same row is deleted once, and it fails SAFE — a reference
  // query that throws deletes nothing and still returns 200.
  const paths = await releasablePaths(
    blobRows.flatMap((r) => [r.video_storage_path, r.azure_blob_path, r.document_storage_path]),
    'lms',
  );

  const { blobsDeleted, blobsFailed } = await cleanupBlobs(paths, 'module-delete', moduleId);

  return reply(200, { success: true, blobsDeleted, blobsFailed });
});
