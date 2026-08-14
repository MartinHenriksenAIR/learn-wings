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

  const candidates: UploadCandidate[] = [
    { path: videoStoragePath as string | null | undefined, kind: 'video', family: 'lms' },
    { path: azureBlobPath as string | null | undefined, kind: 'video', family: 'lms' },
    { path: documentStoragePath as string | null | undefined, kind: 'document', family: 'lms' },
  ];

  const bindError = await assertBindablePaths(candidates);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  const limitError = await enforceUploadLimits(candidates);
  if (limitError) {
    return reply(413, { error: limitError });
  }

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
