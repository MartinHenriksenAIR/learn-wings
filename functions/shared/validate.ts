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

const LESSON_TYPES = ['video', 'document', 'quiz', 'exercise'] as const;

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

export function validateLessonFields(body: LessonFieldsBody): string | null {
  const { moduleId, title, lessonType, contentText, durationMinutes, videoStoragePath, azureBlobPath, documentStoragePath } = body;

  if (!moduleId || typeof moduleId !== 'string') {
    return 'moduleId is required';
  }

  if (!title || typeof title !== 'string' || (title as string).trim() === '') {
    return 'title is required';
  }

  if (!lessonType || !LESSON_TYPES.includes(lessonType as (typeof LESSON_TYPES)[number])) {
    return "lessonType must be 'video', 'document', 'quiz', or 'exercise'";
  }

  if (contentText !== undefined && !isStringOrNull(contentText)) {
    return 'contentText must be a string or null';
  }

  if (durationMinutes !== undefined && !isIntOrNull(durationMinutes)) {
    return 'durationMinutes must be an integer or null';
  }

  if (videoStoragePath !== undefined && !isNonEmptyStringOrNull(videoStoragePath)) {
    return 'videoStoragePath must be a non-empty string or null';
  }

  if (azureBlobPath !== undefined && !isNonEmptyStringOrNull(azureBlobPath)) {
    return 'azureBlobPath must be a non-empty string or null';
  }

  if (documentStoragePath !== undefined && !isNonEmptyStringOrNull(documentStoragePath)) {
    return 'documentStoragePath must be a non-empty string or null';
  }

  return null;
}
