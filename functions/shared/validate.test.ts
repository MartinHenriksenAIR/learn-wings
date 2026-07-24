import { describe, it, expect } from 'vitest';
import { validateLessonFields, isHttpUrl, validateHttpUrl } from './validate';

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
  it('rejects contentText as an object', () => {
    expect(validateLessonFields({ ...validBase, contentText: {} })).toBe('contentText must be a string or null');
  });
  it('rejects contentText as an array', () => {
    expect(validateLessonFields({ ...validBase, contentText: [] })).toBe('contentText must be a string or null');
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
  it('accepts durationMinutes as a negative integer', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: -5 })).toBeNull();
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
  it('rejects durationMinutes as a boolean', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: true })).toBe(
      'durationMinutes must be an integer or null',
    );
  });
  it('rejects durationMinutes as NaN', () => {
    expect(validateLessonFields({ ...validBase, durationMinutes: NaN })).toBe(
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

// ---------------------------------------------------------------------------
// isHttpUrl / validateHttpUrl (sec-1, #232) — defence in depth against stored XSS
// ---------------------------------------------------------------------------

describe('isHttpUrl', () => {
  it('accepts http', () => expect(isHttpUrl('http://example.com')).toBe(true));
  it('accepts https', () => expect(isHttpUrl('https://example.com/x?a=1#f')).toBe(true));
  it('accepts an uppercase scheme', () => expect(isHttpUrl('HTTPS://example.com')).toBe(true));
  it('accepts a URL with surrounding whitespace', () =>
    expect(isHttpUrl('  https://example.com  ')).toBe(true));

  it('rejects javascript:', () => expect(isHttpUrl('javascript:alert(1)')).toBe(false));
  it('rejects whitespace-prefixed javascript:', () =>
    expect(isHttpUrl('  javascript:alert(1)')).toBe(false));
  it('rejects mailto: (not http/https)', () =>
    expect(isHttpUrl('mailto:a@b.com')).toBe(false));
  it('rejects data:', () => expect(isHttpUrl('data:text/html,<x>')).toBe(false));
  it('rejects vbscript:', () => expect(isHttpUrl('vbscript:msgbox(1)')).toBe(false));
  it('rejects file:', () => expect(isHttpUrl('file:///etc/passwd')).toBe(false));
  it('rejects a relative path', () => expect(isHttpUrl('/foo/bar')).toBe(false));
  it('rejects a bare host', () => expect(isHttpUrl('example.com')).toBe(false));
  it('rejects empty string', () => expect(isHttpUrl('')).toBe(false));
  it('rejects whitespace-only', () => expect(isHttpUrl('   ')).toBe(false));
  it('rejects null', () => expect(isHttpUrl(null)).toBe(false));
  it('rejects a number', () => expect(isHttpUrl(42)).toBe(false));
});

describe('validateHttpUrl — optional field', () => {
  it('returns null when absent (undefined)', () =>
    expect(validateHttpUrl(undefined, 'url')).toBeNull());
  it('returns null when null', () => expect(validateHttpUrl(null, 'url')).toBeNull());
  it('returns null for empty string (treated as absent)', () =>
    expect(validateHttpUrl('', 'url')).toBeNull());
  it('returns null for whitespace-only (treated as absent)', () =>
    expect(validateHttpUrl('   ', 'url')).toBeNull());
  it('returns null for a valid https URL', () =>
    expect(validateHttpUrl('https://example.com', 'url')).toBeNull());

  it('returns a field-specific message for javascript:', () =>
    expect(validateHttpUrl('javascript:alert(1)', 'eventRegistrationUrl')).toBe(
      'eventRegistrationUrl must be a valid http(s) URL',
    ));
  it('rejects data: with the field name', () =>
    expect(validateHttpUrl('data:text/html,<x>', 'url')).toBe(
      'url must be a valid http(s) URL',
    ));
  it('rejects a relative path', () =>
    expect(validateHttpUrl('/foo', 'url')).toBe('url must be a valid http(s) URL'));
  it('rejects a non-string, non-null value', () =>
    expect(validateHttpUrl(42, 'url')).toBe('url must be a valid http(s) URL'));
});
