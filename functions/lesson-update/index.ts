import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { requirePlatformAdmin } from '../shared/guards';
import { validateLessonFields } from '../shared/validate';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;

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
      return corsResponse(origin, 400, { error: 'lessonId is required' });
    }

    // Shared field validation (moduleId, title, lessonType, and all optional fields)
    const sharedError = validateLessonFields(body);
    if (sharedError) {
      return corsResponse(origin, 400, { error: sharedError });
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
      return corsResponse(origin, 404, { error: 'Lesson not found' });
    }

    return corsResponse(origin, 200, { lesson });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('lesson-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
