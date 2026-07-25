import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { validateLessonFields } from '../shared/validate';
import { deleteBlob } from '../shared/blob';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths, isBlobReleasable } from '../shared/blob-ownership';

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

  /**
   * The blob paths this update will write. Normalized once so the UPDATE params
   * and the superseded-blob comparison below can never drift apart.
   *
   * AN ABSENT KEY IS NOT A CLEAR — it keeps whatever the row already has. The
   * other three blob-writing endpoints (course-update, organization-update,
   * profile-update) all draw that distinction deliberately; this one used to
   * collapse it with `?? null`, so a sparse payload nulled the column. That was
   * merely lossy while the column was inert, and became destructive the moment a
   * clear started deleting the file. Only an EXPLICIT `null` clears.
   *
   * The current frontend always posts the full payload, so no live caller changes
   * behaviour; what changes is that a partial one can no longer delete a video by
   * omission.
   *
   * The fallback is read from the `previous` SELECT above, which widens that
   * SELECT's race window by two awaits (the ownership query and the storage HEAD).
   * A concurrent update that replaced the same column will have deleted the old
   * blob by the time this one writes the carried-forward value back, leaving a
   * dangling reference. That is strictly better than the `?? null` it replaces —
   * which reacted to the same race by DELETING the concurrent writer's new blob —
   * and a dangling path degrades to a broken image, not to lost bytes.
   */
  const nextPath = (
    key: 'videoStoragePath' | 'azureBlobPath' | 'documentStoragePath',
    value: unknown,
    current: string | null | undefined,
  ): string | null => (key in body ? ((value as string | null | undefined) ?? null) : (current ?? null));

  const nextVideoStoragePath = nextPath('videoStoragePath', videoStoragePath, previous?.video_storage_path);
  const nextAzureBlobPath = nextPath('azureBlobPath', azureBlobPath, previous?.azure_blob_path);
  const nextDocumentStoragePath = nextPath('documentStoragePath', documentStoragePath, previous?.document_storage_path);

  // One candidate list, handed to both gates in order, so they can never be given
  // different views of the same write. All three columns share the flat `lms`
  // namespace with course thumbnails (`azure-upload-url` gives non-branding
  // uploads an empty prefix), so `kind` is what separates them: it is the
  // extension allow-list, not the path shape, that keeps a `.png` out of
  // video_storage_path.
  const candidates: UploadCandidate[] = [
    { path: nextVideoStoragePath, kind: 'video', family: 'lms' },
    { path: nextAzureBlobPath, kind: 'video', family: 'lms' },
    { path: nextDocumentStoragePath, kind: 'document', family: 'lms' },
  ];
  const previousPaths = [
    previous?.video_storage_path,
    previous?.azure_blob_path,
    previous?.document_storage_path,
  ];

  // Ownership gate FIRST — before `enforceUploadLimits`, so no path this caller
  // may not bind is ever handed to `headBlob`. Within the flat namespace the
  // binding rule is "already on this row, or referenced by no row at all", since
  // the prefix cannot distinguish one lesson's video from another's.
  const bindError = await assertBindablePaths(candidates, previousPaths);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  // Size/type gate on the blobs this update newly references (#276). The client's
  // caps are advisory (the browser PUTs straight to storage), so this is where an
  // over-cap upload is actually stopped — before the row is written, so a refused
  // blob is never persisted. `previous` is passed in whole: a path already stored
  // in ANY of the three columns is not new, so an unchanged video costs no HEAD
  // and a blob deleted from storage by hand can never block a later save.
  const limitError = await enforceUploadLimits(candidates, previousPaths);
  if (limitError) {
    return reply(413, { error: limitError });
  }

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
    // `isBlobReleasable` runs AFTER the UPDATE on purpose: this row now points at
    // the new values, so "does any row still reference the old path?" is exactly
    // the question worth asking — and in a flat namespace it is the only thing
    // that can tell a superseded video from another lesson's live one.
    await Promise.all([...superseded].map(async (path) => {
      if (await isBlobReleasable(path, 'lms')) await deleteBlob(path);
    }));
  }

  return reply(200, { lesson });
});
