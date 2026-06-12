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
      moduleId?: unknown;
      title?: unknown;
      lessonType?: unknown;
      contentText?: unknown;
      durationMinutes?: unknown;
      videoStoragePath?: unknown;
      azureBlobPath?: unknown;
      documentStoragePath?: unknown;
      sortOrder?: unknown;
    };

    const { moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath, sortOrder } = body;

    // Shared field validation (moduleId, title, lessonType, and all optional fields)
    const sharedError = validateLessonFields(body);
    if (sharedError) {
      return corsResponse(origin, 400, { error: sharedError });
    }

    // Required: sortOrder must be integer (create-only field)
    if (!Number.isInteger(sortOrder)) {
      return corsResponse(origin, 400, { error: 'sortOrder must be an integer' });
    }

    // Params order: [moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, null (video_url), azureBlobPath, documentStoragePath, sortOrder]
    const lesson = await queryOne(
      `INSERT INTO lessons (module_id, title, lesson_type, content_text, duration_minutes, video_storage_path, video_url, azure_blob_path, document_storage_path, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        sortOrder as number,
      ],
    );

    return corsResponse(origin, 200, { lesson });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('lesson-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
