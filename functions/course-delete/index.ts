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
    `SELECT l.video_storage_path, l.azure_blob_path, l.document_storage_path
       FROM lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE m.course_id = $1
        AND (l.video_storage_path IS NOT NULL
          OR l.azure_blob_path IS NOT NULL
          OR l.document_storage_path IS NOT NULL)`,
    [courseId],
  );

  // The course's OWN thumbnail comes back from the DELETE rather than a separate
  // SELECT — it lives on the row being removed, so RETURNING it is both cheaper
  // and race-free. It was previously collected by nobody: PR #279's production
  // smoke deleted a course and watched its thumbnail blob survive until the
  // nightly sweep (#280). `thumbnail_url` may legitimately hold an absolute
  // external URL, which `releasablePaths` refuses to release.
  const deleted = await queryOne<{ id: string; thumbnail_url: string | null }>(
    `DELETE FROM courses WHERE id = $1 RETURNING id, thumbnail_url`,
    [courseId],
  );

  if (!deleted) return reply(404, { error: 'Course not found' });

  // The release gate runs AFTER the DELETE, and that ordering is the whole point:
  // the course and its lessons are gone (ON DELETE CASCADE), so anything still
  // coming back referenced belongs to a DIFFERENT row and must survive. The bind
  // gate (`assertBindablePaths`) means new shared state can no longer be created,
  // but production ran without it, so a pre-existing shared path was destroyable
  // on the first cascade delete that touched it (#280).
  //
  // Placed HERE rather than inside `cleanupBlobs` deliberately — see the same
  // note in module-delete for the full reasoning (circular import, no family at
  // that layer, and only two of the eight delete sites go through it).
  //
  // `releasablePaths` also drops nulls and collapses duplicates, so a thumbnail
  // that is also a lesson path is deleted once, and it fails SAFE — a reference
  // query that throws deletes nothing and still returns 200.
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
