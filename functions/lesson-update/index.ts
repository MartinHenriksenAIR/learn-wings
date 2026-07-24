import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { validateLessonFields } from '../shared/validate';
import { deleteBlob } from '../shared/blob';

export default adminEndpoint('lesson-update', async ({ req, reply }) => {
  const body = await req.json() as {
    lessonId?: unknown;
    moduleId?: unknown;
    title?: unknown;
    lessonType?: unknown;
    contentText?: unknown;
    durationMinutes?: unknown;
    videoStoragePath?: unknown;
    azureBlobPath?: unknown;
    documentStoragePath?: unknown;
  };

  const { lessonId, moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath } = body;

  // Required: lessonId (update-only field)
  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }

  // Shared field validation (moduleId, title, lessonType, and all optional fields)
  const sharedError = validateLessonFields(body);
  if (sharedError) {
    return reply(400, { error: sharedError });
  }

  // The blob paths this update will write. Normalized once so the UPDATE params
  // and the superseded-blob comparison below can never drift apart.
  const nextVideoStoragePath = (videoStoragePath as string | null | undefined) ?? null;
  const nextAzureBlobPath = (azureBlobPath as string | null | undefined) ?? null;
  const nextDocumentStoragePath = (documentStoragePath as string | null | undefined) ?? null;

  // Previous blob paths, read before the write so the update can delete the blobs
  // it supersedes — every replace (and every clear-to-null) used to strand a file,
  // and lesson videos are the heaviest assets in the system.
  //
  // A plain SELECT rather than pulling the old values out of the UPDATE itself:
  // the UPDATE's `RETURNING *` row is handed straight back to the client, so the
  // self-join form (`UPDATE lessons l ... FROM lessons prev ... RETURNING l.*,
  // prev.<col>`) would leak prev_* columns into the response body and require
  // stripping them back out.
  //
  // Deliberately NOT transactional (parity with course-delete/module-delete):
  // blob deletes are irreversible and cannot join a DB transaction, and a
  // stranded blob is strictly less bad than a failed update.
  const previous = await queryOne<{
    video_storage_path: string | null;
    azure_blob_path: string | null;
    document_storage_path: string | null;
  }>(
    `SELECT video_storage_path, azure_blob_path, document_storage_path
       FROM lessons
      WHERE id = $1`,
    [lessonId],
  );

  // Full-row UPDATE (old client always sent full payload — not a sparse patch).
  // video_url is literal NULL (deprecated column, old payload parity).
  // sort_order is NOT touched — old update payload never included it.
  // Params: [moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath, lessonId]
  const lesson = await queryOne(
    `UPDATE lessons
     SET module_id=$1, title=$2, lesson_type=$3, content_text=$4, duration_minutes=$5,
         video_storage_path=$6, video_url=NULL, azure_blob_path=$7, document_storage_path=$8
     WHERE id=$9
     RETURNING *`,
    [
      moduleId as string,
      title as string,
      lessonType as string,
      (contentText as string | null | undefined) ?? null,
      (durationMinutes as number | null | undefined) ?? null,
      nextVideoStoragePath,
      nextAzureBlobPath,
      nextDocumentStoragePath,
      lessonId as string,
    ],
  );

  if (!lesson) {
    return reply(404, { error: 'Lesson not found' });
  }

  // Best-effort cleanup of every blob this update replaced or cleared, only after
  // the row write succeeded. Each of the three columns is considered
  // independently, then set-differenced against the paths the row still
  // references — so an unchanged column is never touched (re-saving an unrelated
  // field must not delete a live video) and a path that merely moved between
  // columns survives. `video_url` is set to NULL above but is a deprecated
  // EXTERNAL url, never a blob path, so it is deliberately not part of this.
  //
  // deleteBlob never throws and its result is deliberately NOT surfaced in the
  // response — server logs are the only failure signal (parity with
  // lesson-delete, which reports only its own single blob).
  if (previous) {
    const stillReferenced = new Set(
      [nextVideoStoragePath, nextAzureBlobPath, nextDocumentStoragePath]
        .filter((p): p is string => !!p),
    );
    const superseded = new Set(
      [previous.video_storage_path, previous.azure_blob_path, previous.document_storage_path]
        .filter((p): p is string => !!p && !stillReferenced.has(p)),
    );
    await Promise.all([...superseded].map((path) => deleteBlob(path)));
  }

  return reply(200, { lesson });
});
