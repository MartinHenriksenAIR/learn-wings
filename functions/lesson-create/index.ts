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

    // Required: sortOrder must be integer
    if (!Number.isInteger(sortOrder)) {
      return corsResponse(origin, 400, { error: 'sortOrder must be an integer' }) as HttpResponseInit;
    }

    // Optional: contentText — string or null; anything else is a type violation
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

    return corsResponse(origin, 200, { lesson }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('lesson-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
