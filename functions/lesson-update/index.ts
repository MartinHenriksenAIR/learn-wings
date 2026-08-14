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

  if (!lessonId || typeof lessonId !== 'string') {
    return reply(400, { error: 'lessonId is required' });
  }

  const sharedError = validateLessonFields(body);
  if (sharedError) {
    return reply(400, { error: sharedError });
  }

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

  const nextPath = (
    key: 'videoStoragePath' | 'azureBlobPath' | 'documentStoragePath',
    value: unknown,
    current: string | null | undefined,
  ): string | null => (key in body ? ((value as string | null | undefined) ?? null) : (current ?? null));

  const nextVideoStoragePath = nextPath('videoStoragePath', videoStoragePath, previous?.video_storage_path);
  const nextAzureBlobPath = nextPath('azureBlobPath', azureBlobPath, previous?.azure_blob_path);
  const nextDocumentStoragePath = nextPath('documentStoragePath', documentStoragePath, previous?.document_storage_path);

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

  const bindError = await assertBindablePaths(candidates, previousPaths);
  if (bindError) {
    return reply(400, { error: bindError });
  }

  const limitError = await enforceUploadLimits(candidates, previousPaths);
  if (limitError) {
    return reply(413, { error: limitError });
  }

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

  if (previous) {
    const stillReferenced = new Set(
      [nextVideoStoragePath, nextAzureBlobPath, nextDocumentStoragePath]
        .filter((p): p is string => !!p),
    );
    const superseded = new Set(
      [previous.video_storage_path, previous.azure_blob_path, previous.document_storage_path]
        .filter((p): p is string => !!p && !stillReferenced.has(p)),
    );
    await Promise.all([...superseded].map(async (path) => {
      if (await isBlobReleasable(path, 'lms')) await deleteBlob(path);
    }));
  }

  return reply(200, { lesson });
});
