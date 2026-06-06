import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

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

    // Required: lessonId
    if (!lessonId || typeof lessonId !== 'string') {
      return corsResponse(origin, 400, { error: 'lessonId is required' }) as HttpResponseInit;
    }

    // Required: moduleId
    if (!moduleId || typeof moduleId !== 'string') {
      return corsResponse(origin, 400, { error: 'moduleId is required' }) as HttpResponseInit;
    }

    // Required: title (trim-validate, store raw)
    if (!title || typeof title !== 'string' || (title as string).trim() === '') {
      return corsResponse(origin, 400, { error: 'title is required' }) as HttpResponseInit;
    }

    // Required: lessonType ∈ ('video','document','quiz')
    if (!lessonType || !['video', 'document', 'quiz'].includes(lessonType as string)) {
      return corsResponse(origin, 400, { error: "lessonType must be 'video', 'document', or 'quiz'" }) as HttpResponseInit;
    }

    // Optional: contentText — string or null
    if (contentText !== undefined && contentText !== null && typeof contentText !== 'string') {
      return corsResponse(origin, 400, { error: 'contentText must be a string or null' }) as HttpResponseInit;
    }

    // Optional: durationMinutes — integer or null
    if (durationMinutes !== undefined && durationMinutes !== null && !Number.isInteger(durationMinutes)) {
      return corsResponse(origin, 400, { error: 'durationMinutes must be an integer or null' }) as HttpResponseInit;
    }

    // Optional: videoStoragePath — string or null
    if (videoStoragePath !== undefined && videoStoragePath !== null && typeof videoStoragePath !== 'string') {
      return corsResponse(origin, 400, { error: 'videoStoragePath must be a string or null' }) as HttpResponseInit;
    }

    // Optional: azureBlobPath — string or null
    if (azureBlobPath !== undefined && azureBlobPath !== null && typeof azureBlobPath !== 'string') {
      return corsResponse(origin, 400, { error: 'azureBlobPath must be a string or null' }) as HttpResponseInit;
    }

    // Optional: documentStoragePath — string or null
    if (documentStoragePath !== undefined && documentStoragePath !== null && typeof documentStoragePath !== 'string') {
      return corsResponse(origin, 400, { error: 'documentStoragePath must be a string or null' }) as HttpResponseInit;
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
        (videoStoragePath as string | null | undefined) ?? null,
        (azureBlobPath as string | null | undefined) ?? null,
        (documentStoragePath as string | null | undefined) ?? null,
        lessonId as string,
      ],
    );

    if (!lesson) {
      return corsResponse(origin, 404, { error: 'Lesson not found' }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { lesson }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('lesson-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
