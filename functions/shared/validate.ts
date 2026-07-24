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

/**
 * True when `value` is a string whose scheme is http: or https: (defence in
 * depth against stored-XSS — sec-1, #232). Community URL fields (event
 * registration/recording URLs, resource URLs) are rendered into anchor hrefs,
 * where React 18 does NOT block `javascript:` and friends; rejecting non-http(s)
 * schemes on write keeps such payloads out of the database entirely.
 *
 * Parses with the URL constructor (no base) so casing, whitespace, and exotic
 * encodings can't smuggle a bad scheme past, and relative/unparseable input is
 * rejected — these fields are meant to be absolute external URLs.
 */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates an OPTIONAL URL field that must be an http(s) URL when present.
 * Returns null when the value is acceptable (absent, null, empty string, or a
 * valid http/https URL); returns an error message string otherwise. `fieldName`
 * is interpolated into the message so callers get a field-specific 400.
 *
 * Empty/absent is allowed because these fields are optional in the schema and
 * elsewhere (the create/update handlers) coalesce '' → null.
 */
export function validateHttpUrl(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (!isHttpUrl(value)) {
    return `${fieldName} must be a valid http(s) URL`;
  }
  return null;
}

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
