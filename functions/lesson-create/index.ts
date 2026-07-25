import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { validateLessonFields } from '../shared/validate';
import { enforceUploadLimits, type UploadCandidate } from '../shared/upload-limits';
import { assertBindablePaths } from '../shared/blob-ownership';

export default adminEndpoint('lesson-create', async ({ req, reply }) => {
  const body = await req.json() as {
    moduleId?: unknown;
    title?: unknown;
    lessonType?: unknown;
    contentText?: unknown;
    durationMinutes?: unknown;
    videoStoragePath?: unknown;
    azureBlobPath?: unknown;
    documentStoragePath?: unknown;
  };

  const { moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath } = body;

  const sharedError = validateLessonFields(body);
  if (sharedError) {
    return reply(400, { error: sharedError });
  }

  // One candidate list, handed to both gates in order. There is no previous row,
  // so no path is ever exempt: every supplied path must be one no row references.
  const candidates: UploadCandidate[] = [
    { path: videoStoragePath as string | null | undefined, kind: 'video', family: 'lms' },
    { path: azureBlobPath as string | null | undefined, kind: 'video', family: 'lms' },
    { path: documentStoragePath as string | null | undefined, kind: 'document', family: 'lms' },
  ];

  // Ownership gate FIRST, before `enforceUploadLimits` reaches storage. A create
  // has nothing to supersede, so this cannot lead to a delete — but binding another
  // lesson's live video would make the two rows share a blob, which is exactly the
  // state that later turns an ordinary edit into someone else's data loss.
  const bindError = await assertBindablePaths(candidates);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  // Size/type gate on the blobs this insert references (#276). There is no
  // previous row, so every supplied path is new and gets probed; over-cap or
  // off-allowlist means no row is inserted at all.
  const limitError = await enforceUploadLimits(candidates);
  if (limitError) {
    return reply(413, { error: limitError });
  }

  // sort_order is server-owned (issue #46): computed as MAX+1 within the module
  // inside the INSERT. Any client-supplied sortOrder is ignored — array-length
  // ranks from the client collided after delete-middle-then-add.
  // Params order: [moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, null (video_url), azureBlobPath, documentStoragePath]
  const lesson = await queryOne(
    `INSERT INTO lessons (module_id, title, lesson_type, content_text, duration_minutes, video_storage_path, video_url, azure_blob_path, document_storage_path, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM lessons WHERE module_id = $1))
     RETURNING *`,
    [
      moduleId as string,
      title as string,
      lessonType as string,
      (contentText as string | null | undefined) ?? null,
      (durationMinutes as number | null | undefined) ?? null,
      (videoStoragePath as string | null | undefined) ?? null,
      null, // video_url — deprecated column, always null (old client parity)
      (azureBlobPath as string | null | undefined) ?? null,
      (documentStoragePath as string | null | undefined) ?? null,
    ],
  );

  return reply(200, { lesson });
});
