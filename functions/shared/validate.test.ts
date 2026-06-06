import { describe, it, expect } from 'vitest';
import { isStringOrNull, isNonEmptyStringOrNull, isIntOrNull, validateLessonFields } from './validate';

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('isStringOrNull', () => {
  it('accepts a non-empty string', () => expect(isStringOrNull('hello')).toBe(true));
  it('accepts an empty string', () => expect(isStringOrNull('')).toBe(true));
  it('accepts null', () => expect(isStringOrNull(null)).toBe(true));
  it('rejects undefined', () => expect(isStringOrNull(undefined)).toBe(false));
  it('rejects a number', () => expect(isStringOrNull(42)).toBe(false));
  it('rejects a boolean', () => expect(isStringOrNull(true)).toBe(false));
  it('rejects an object', () => expect(isStringOrNull({})).toBe(false));
  it('rejects an array', () => expect(isStringOrNull([])).toBe(false));
});

describe('isNonEmptyStringOrNull', () => {
  it('accepts a non-empty string', () => expect(isNonEmptyStringOrNull('path/to/file')).toBe(true));
  it('accepts null', () => expect(isNonEmptyStringOrNull(null)).toBe(true));
  it('rejects empty string', () => expect(isNonEmptyStringOrNull('')).toBe(false));
  it('rejects undefined', () => expect(isNonEmptyStringOrNull(undefined)).toBe(false));
  it('rejects a number', () => expect(isNonEmptyStringOrNull(123)).toBe(false));
  it('rejects a boolean', () => expect(isNonEmptyStringOrNull(false)).toBe(false));
  it('rejects an object', () => expect(isNonEmptyStringOrNull({})).toBe(false));
});

describe('isIntOrNull', () => {
  it('accepts zero', () => expect(isIntOrNull(0)).toBe(true));
  it('accepts a positive integer', () => expect(isIntOrNull(30)).toBe(true));
  it('accepts a negative integer', () => expect(isIntOrNull(-5)).toBe(true));
  it('accepts null', () => expect(isIntOrNull(null)).toBe(true));
  it('rejects a float', () => expect(isIntOrNull(1.5)).toBe(false));
  it('rejects a string', () => expect(isIntOrNull('30')).toBe(false));
  it('rejects undefined', () => expect(isIntOrNull(undefined)).toBe(false));
  it('rejects a boolean', () => expect(isIntOrNull(true)).toBe(false));
  it('rejects NaN', () => expect(isIntOrNull(NaN)).toBe(false));
});

// ---------------------------------------------------------------------------
// validateLessonFields
// ---------------------------------------------------------------------------

const validBase = {
  moduleId: 'mod-1',
  title: 'Lesson Title',
  lessonType: 'video',
};

describe('validateLessonFields — required fields', () => {
  it('returns null for a valid minimal body', () => {
    expect(validateLessonFields(validBase)).toBeNull();
  });

  // moduleId
  it('rejects missing moduleId', () => {
    const { moduleId: _m, ...body } = validBase;
    expect(validateLessonFields(body)).toBe('moduleId is required');
  });
  it('rejects moduleId as empty string', () => {
    expect(validateLessonFields({ ...validBase, moduleId: '' })).toBe('moduleId is required');
  });
  it('rejects moduleId as a number', () => {
    expect(validateLessonFields({ ...validBase, moduleId: 42 })).toBe('moduleId is required');
  });

  // title
  it('rejects missing title', () => {
    const { title: _t, ...body } = validBase;
    expect(validateLessonFields(body)).toBe('title is required');
  });
  it('rejects title as empty string', () => {
    expect(validateLessonFields({ ...validBase, title: '' })).toBe('title is required');
  });
  it('rejects title that is whitespace-only', () => {
    expect(validateLessonFields({ ...validBase, title: '   ' })).toBe('title is required');
  });
  it('rejects title as a number', () => {
    expect(validateLessonFields({ ...validBase, title: 99 })).toBe('title is required');
  });
  it('accepts title with leading/trailing whitespace (stored raw)', () => {
    expect(validateLessonFields({ ...validBase, title: '  Real Title  ' })).toBeNull();
  });

  // lessonType
  it('rejects missing lessonType', () => {
    const { lessonType: _l, ...body } = validBase;
    expect(validateLessonFields(body)).toBe("lessonType must be 'video', 'document', or 'quiz'");
  });
  it('rejects invalid lessonType', () => {
    expect(validateLessonFields({ ...validBase, lessonType: 'audio' })).toBe(
      "lessonType must be 'video', 'document', or 'quiz'",
    );
  });
  it('accepts video', () => expect(validateLessonFields({ ...validBase, lessonType: 'video' })).toBeNull());
  it('accepts document', () => expect(validateLessonFields({ ...validBase, lessonType: 'document' })).toBeNull());
  it('accepts quiz', () => expect(validateLessonFields({ ...validBase, lessonType: 'quiz' })).toBeNull());
});

describe('validateLessonFields — optional fields', () => {
  // contentText
  it('accepts contentText as a string', () => {
    expect(validateLessonFields({ ...validBase, contentText: 'some text' })).toBeNull();
  });
  it('accepts contentText as null', () => {
    expect(validateLessonFields({ ...validBase, contentText: null })).toBeNull();
  });
  it('accepts contentText as undefined (omitted)', () => {
    expect(validateLessonFields({ ...validBase })).toBeNull();
  });
  it('rejects contentText as a number', () => {
    expect(validateLessonFields({ ...validBase, contentText: 42 })).toBe('contentText must be a string or null');
  });
  it('rejects contentText as a boolean', () => {
    expect(validateLessonFields({ ...validBase, contentText: true })).toBe('contentText must be a string or null');
  });

  // durationMinutes
  it('accepts durationMinutes as an integer', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: 30 })).toBeNull();
  });
  it('accepts durationMinutes as 0', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: 0 })).toBeNull();
  });
  it('accepts durationMinutes as null', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: null })).toBeNull();
  });
  it('rejects durationMinutes as a float', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: 1.5 })).toBe(
      'durationMinutes must be an integer or null',
    );
  });
  it('rejects durationMinutes as a string', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: 'five' })).toBe(
      'durationMinutes must be an integer or null',
    );
  });

  // videoStoragePath
  it('accepts videoStoragePath as a non-empty string', () => {
    expect(validateLessonFields({ ...validBase, videoStoragePath: 'path/to/video.mp4' })).toBeNull();
  });
  it('accepts videoStoragePath as null', () => {
    expect(validateLessonFields({ ...validBase, videoStoragePath: null })).toBeNull();
  });
  it('rejects videoStoragePath as empty string', () => {
    expect(validateLessonFields({ ...validBase, videoStoragePath: '' })).toBe(
      'videoStoragePath must be a non-empty string or null',
    );
  });
  it('rejects videoStoragePath as a number', () => {
    expect(validateLessonFields({ ...validBase, videoStoragePath: 123 })).toBe(
      'videoStoragePath must be a non-empty string or null',
    );
  });

  // azureBlobPath
  it('accepts azureBlobPath as a non-empty string', () => {
    expect(validateLessonFields({ ...validBase, azureBlobPath: 'blob/path' })).toBeNull();
  });
  it('accepts azureBlobPath as null', () => {
    expect(validateLessonFields({ ...validBase, azureBlobPath: null })).toBeNull();
  });
  it('rejects azureBlobPath as empty string', () => {
    expect(validateLessonFields({ ...validBase, azureBlobPath: '' })).toBe(
      'azureBlobPath must be a non-empty string or null',
    );
  });
  it('rejects azureBlobPath as a boolean', () => {
    expect(validateLessonFields({ ...validBase, azureBlobPath: true })).toBe(
      'azureBlobPath must be a non-empty string or null',
    );
  });

  // documentStoragePath
  it('accepts documentStoragePath as a non-empty string', () => {
    expect(validateLessonFields({ ...validBase, documentStoragePath: 'doc/path.pdf' })).toBeNull();
  });
  it('accepts documentStoragePath as null', () => {
    expect(validateLessonFields({ ...validBase, documentStoragePath: null })).toBeNull();
  });
  it('rejects documentStoragePath as empty string', () => {
    expect(validateLessonFields({ ...validBase, documentStoragePath: '' })).toBe(
      'documentStoragePath must be a non-empty string or null',
    );
  });
  it('rejects documentStoragePath as an object', () => {
    expect(validateLessonFields({ ...validBase, documentStoragePath: {} })).toBe(
      'documentStoragePath must be a non-empty string or null',
    );
  });
});
