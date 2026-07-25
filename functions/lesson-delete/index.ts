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

  // Step 1: Delete the row first and retrieve its blob paths in one statement (no
  // separate SELECT). Row-first ordering: if the DB fails here, no irreversible
  // blob delete has happened yet.
  //
  // ALL THREE lesson blob columns, not just azure_blob_path: a document lesson
  // stores its file in document_storage_path and a Supabase-era video sits in
  // video_storage_path, and deleting only azure_blob_path stranded those for the
  // nightly sweep to find (#280). `video_url` is deliberately absent — it is a
  // deprecated EXTERNAL url, never a blob path.
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

  // Step 2: Delete the blobs only after the row is gone — which is also what
  // makes the release check below ask the right question. The lesson that
  // referenced these paths no longer exists, so anything `releasablePaths` still
  // finds referenced belongs to a DIFFERENT row and must not be touched.
  //
  // The bind gate (`assertBindablePaths`) means new shared state can no longer be
  // created, but production ran without it, so a pre-existing shared path was
  // destroyable on the first cascade delete that touched it (#280). The gate also
  // fails SAFE: if the reference query throws, nothing is deleted and the request
  // still succeeds.
  const releasable = await releasablePaths(
    [deleted.video_storage_path, deleted.azure_blob_path, deleted.document_storage_path],
    'lms',
  );

  // blobDeleted stays the response contract the frontend reads: null when this
  // lesson had nothing of its own to delete (no paths, or none releasable) —
  // distinct from a real storage failure (false). With up to three paths it
  // summarizes them: false if ANY delete failed, which is exactly the condition
  // CourseEditor warns on.
  let blobDeleted: boolean | null = null;
  if (releasable.length > 0) {
    const results = await Promise.all(releasable.map((path) => deleteBlob(path)));
    blobDeleted = results.every(Boolean);
  }

  return reply(200, { success: true, blobDeleted });
});
