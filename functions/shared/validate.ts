/**
 * Shared field validators for Azure Functions endpoint validation.
 *
 * validateLessonFields(body) — validates the fields shared by lesson-create AND lesson-update:
 *   Required: moduleId, title (non-empty trim), lessonType ∈ ('video','document','quiz')
 *   Optional: contentText (string|null), durationMinutes (int|null),
 *             videoStoragePath / azureBlobPath / documentStoragePath (non-empty string|null)
 *
 * Returns null on success; returns an error message string on first failure.
 * The caller returns its existing 400 response with { error: <message> }.
 *
 * NOT included: sortOrder (create-only), lessonId (update-only).
 */

function isStringOrNull(v: unknown): boolean {
  return v === null || typeof v === 'string';
}

function isNonEmptyStringOrNull(v: unknown): boolean {
  if (v === null) return true;
  return typeof v === 'string' && v.length > 0;
}

function isIntOrNull(v: unknown): boolean {
  return v === null || Number.isInteger(v);
}

const LESSON_TYPES = ['video', 'document', 'quiz'] as const;

export interface LessonFieldsBody {
  moduleId?: unknown;
  title?: unknown;
  lessonType?: unknown;
  contentText?: unknown;
  durationMinutes?: unknown;
  videoStoragePath?: unknown;
  azureBlobPath?: unknown;
  documentStoragePath?: unknown;
  [key: string]: unknown;
}

/**
 * Validates the lesson fields shared between lesson-create and lesson-update.
 * Returns null if all fields are valid; returns an error message string on the first failure.
 */
export function validateLessonFields(body: LessonFieldsBody): string | null {
  const { moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath } = body;

  // Required: moduleId — non-empty string
  if (!moduleId || typeof moduleId !== 'string') {
    return 'moduleId is required';
  }

  // Required: title — string with non-empty trim (stored raw)
  if (!title || typeof title !== 'string' || (title as string).trim() === '') {
    return 'title is required';
  }

  // Required: lessonType ∈ ('video','document','quiz')
  if (!lessonType || !LESSON_TYPES.includes(lessonType as (typeof LESSON_TYPES)[number])) {
    return "lessonType must be 'video', 'document', or 'quiz'";
  }

  // Optional: contentText — string or null
  if (contentText !== undefined && !isStringOrNull(contentText)) {
    return 'contentText must be a string or null';
  }

  // Optional: durationMinutes — integer or null
  if (durationMinutes !== undefined && !isIntOrNull(durationMinutes)) {
    return 'durationMinutes must be an integer or null';
  }

  // Optional: videoStoragePath — non-empty string or null ('' is rejected — flows into blob cleanup)
  if (videoStoragePath !== undefined && !isNonEmptyStringOrNull(videoStoragePath)) {
    return 'videoStoragePath must be a non-empty string or null';
  }

  // Optional: azureBlobPath — non-empty string or null
  if (azureBlobPath !== undefined && !isNonEmptyStringOrNull(azureBlobPath)) {
    return 'azureBlobPath must be a non-empty string or null';
  }

  // Optional: documentStoragePath — non-empty string or null
  if (documentStoragePath !== undefined && !isNonEmptyStringOrNull(documentStoragePath)) {
    return 'documentStoragePath must be a non-empty string or null';
  }

  return null;
}
