import { describe, it, expect } from 'vitest';
import {
  BYTES_PER_MB,
  MAX_IMAGE_DECODE_MB,
  UPLOAD_ACCEPT_ATTRIBUTE,
  UPLOAD_MAX_MB,
  checkSelectedFileSize,
  checkUploadFileType,
  checkUploadPayloadSize,
  effectiveMaxSizeMB,
  fileExtension,
  formatSizeMB,
  isAllowedUploadFile,
  willDownscale,
} from './upload-limits';

const mb = (n: number) => n * BYTES_PER_MB;
const pick = (name: string, type = '') => ({ name, type });

describe('UPLOAD_MAX_MB', () => {
  it('pins the caps the UI advertises: video 2 GB, document 100 MB, image 10 MB', () => {
    expect(UPLOAD_MAX_MB.video).toBe(2048);
    expect(UPLOAD_MAX_MB.document).toBe(100);
    expect(UPLOAD_MAX_MB.image).toBe(10);
  });
});

describe('MAX_IMAGE_DECODE_MB', () => {
  it('stays well under anything that would wedge a tab, and above any real photo', () => {
    expect(MAX_IMAGE_DECODE_MB).toBeLessThanOrEqual(20);
    expect(MAX_IMAGE_DECODE_MB).toBeGreaterThanOrEqual(UPLOAD_MAX_MB.image);
  });
});

describe('UPLOAD_ACCEPT_ATTRIBUTE', () => {
  it('offers every format the server accepts for documents — all seven', () => {
    for (const ext of ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']) {
      expect(UPLOAD_ACCEPT_ATTRIBUTE.document).toContain(ext);
    }
  });

  it('offers no video wildcard — .mkv/.avi must not reach the server', () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE.video).not.toContain('video/*');
    expect(UPLOAD_ACCEPT_ATTRIBUTE.video).toContain('.mp4');
    expect(UPLOAD_ACCEPT_ATTRIBUTE.video).toContain('.mov');
  });

  it('lists content types AND extensions, since some platforms report neither well', () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE.image).toContain('image/webp');
    expect(UPLOAD_ACCEPT_ATTRIBUTE.image).toContain('.webp');
    expect(UPLOAD_ACCEPT_ATTRIBUTE.image).not.toContain('.svg');
  });
});

describe('fileExtension', () => {
  it('takes the last dot-separated segment, lower-cased', () => {
    expect(fileExtension('photo.JPG')).toBe('jpg');
    expect(fileExtension('my.holiday.photo.png')).toBe('png');
  });

  it('refuses to treat a dot-less name as one big extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('')).toBe('');
    expect(fileExtension(null)).toBe('');
  });

  it('rejects a non-alphanumeric extension', () => {
    expect(fileExtension('archive.tar gz')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
  });
});

describe('isAllowedUploadFile', () => {
  it('accepts what the server would mint', () => {
    expect(isAllowedUploadFile('image', pick('logo.png', 'image/png'))).toBe(true);
    expect(isAllowedUploadFile('video', pick('clip.mp4', 'video/mp4'))).toBe(true);
    expect(isAllowedUploadFile('document', pick('spec.pdf', 'application/pdf'))).toBe(true);
  });

  it('refuses container formats the server has no extension for', () => {
    expect(isAllowedUploadFile('video', pick('clip.mkv', 'video/x-matroska'))).toBe(false);
    expect(isAllowedUploadFile('video', pick('clip.avi', 'video/x-msvideo'))).toBe(false);
    expect(isAllowedUploadFile('video', pick('clip.wmv', 'video/x-ms-wmv'))).toBe(false);
  });

  it('refuses the formats the server deliberately omits', () => {
    expect(isAllowedUploadFile('image', pick('icon.svg', 'image/svg+xml'))).toBe(false);
    expect(isAllowedUploadFile('image', pick('photo.heic', 'image/heic'))).toBe(false);
  });

  it('applies an explicit image list, not an `image/` prefix', () => {
    expect(isAllowedUploadFile('image', pick('logo.png', 'image/svg+xml'))).toBe(false);
    expect(isAllowedUploadFile('image', pick('logo.png', 'image/bmp'))).toBe(false);
    expect(isAllowedUploadFile('image', pick('photo.jpg', 'image/tiff'))).toBe(false);
  });

  it('accepts the non-standard image/jpg alias, as the server does', () => {
    expect(isAllowedUploadFile('image', pick('photo.jpg', 'image/jpg'))).toBe(true);
  });

  it('treats an empty or generic content type as inconclusive, like the server', () => {
    expect(isAllowedUploadFile('video', pick('clip.mov', ''))).toBe(true);
    expect(isAllowedUploadFile('video', pick('clip.mov', 'application/octet-stream'))).toBe(true);
  });

  it('refuses a file whose declared type contradicts its extension', () => {
    expect(isAllowedUploadFile('image', pick('logo.png', 'video/mp4'))).toBe(false);
    expect(isAllowedUploadFile('document', pick('spec.pdf', 'image/png'))).toBe(false);
  });

  it('refuses a file picked at the wrong call site', () => {
    expect(isAllowedUploadFile('image', pick('clip.mp4', 'video/mp4'))).toBe(false);
    expect(isAllowedUploadFile('document', pick('logo.png', 'image/png'))).toBe(false);
  });

  it('refuses an extension-less name — the server cannot classify it either', () => {
    expect(isAllowedUploadFile('image', pick('screenshot', 'image/png'))).toBe(false);
  });
});

describe('checkUploadFileType', () => {
  it('passes an allowed file', () => {
    expect(checkUploadFileType('image', pick('logo.png', 'image/png'))).toBeNull();
  });

  it('names the formats the picker accepts, per call site', () => {
    expect(checkUploadFileType('image', pick('clip.mkv', 'video/x-matroska'))).toEqual({
      key: 'fileUpload.errorTypeImage',
    });
    expect(checkUploadFileType('video', pick('clip.mkv', 'video/x-matroska'))).toEqual({
      key: 'fileUpload.errorTypeVideo',
    });
    expect(checkUploadFileType('document', pick('notes.txt', 'text/plain'))).toEqual({
      key: 'fileUpload.errorTypeDocument',
    });
  });
});

describe('formatSizeMB', () => {
  it('renders whole-GB figures as GB', () => {
    expect(formatSizeMB(2048)).toBe('2 GB');
    expect(formatSizeMB(1024)).toBe('1 GB');
  });
  it('renders everything else as MB, including non-whole GB multiples', () => {
    expect(formatSizeMB(100)).toBe('100 MB');
    expect(formatSizeMB(10)).toBe('10 MB');
    expect(formatSizeMB(1536)).toBe('1536 MB');
  });
});

describe('effectiveMaxSizeMB', () => {
  it('falls back to the server cap when the call site asks for nothing', () => {
    expect(effectiveMaxSizeMB('image')).toBe(10);
    expect(effectiveMaxSizeMB('video')).toBe(2048);
    expect(effectiveMaxSizeMB('document')).toBe(100);
  });

  it('honours a call site that wants something stricter', () => {
    expect(effectiveMaxSizeMB('image', 2)).toBe(2);
  });

  it('clamps a call site that tries to exceed the server cap', () => {
    expect(effectiveMaxSizeMB('image', 50)).toBe(10);
    expect(effectiveMaxSizeMB('document', 500)).toBe(100);
  });

  it('ignores nonsense requests rather than producing a nonsense cap', () => {
    expect(effectiveMaxSizeMB('image', 0)).toBe(10);
    expect(effectiveMaxSizeMB('image', -5)).toBe(10);
    expect(effectiveMaxSizeMB('image', Number.NaN)).toBe(10);
    expect(effectiveMaxSizeMB('image', undefined)).toBe(10);
  });
});

describe('willDownscale', () => {
  it('is true only for re-encodable images at an image call site', () => {
    expect(willDownscale('image', 'image/jpeg')).toBe(true);
    expect(willDownscale('image', 'image/png')).toBe(true);
    expect(willDownscale('image', 'image/webp')).toBe(true);
  });

  it('is false for image formats we deliberately never re-encode', () => {
    expect(willDownscale('image', 'image/gif')).toBe(false);
    expect(willDownscale('image', 'image/svg+xml')).toBe(false);
  });

  it('is false for video and document call sites', () => {
    expect(willDownscale('video', 'video/mp4')).toBe(false);
    expect(willDownscale('document', 'application/pdf')).toBe(false);
  });
});

describe('checkSelectedFileSize', () => {
  it('measures a NON-downscalable file against the cap directly', () => {
    expect(checkSelectedFileSize(mb(90), 100, false)).toBeNull();
    expect(checkSelectedFileSize(mb(101), 100, false)).toEqual({
      key: 'fileUpload.errorTooLarge',
      values: { size: '100 MB' },
    });
  });

  it('lets an over-cap image through to the downscaler instead of refusing it', () => {
    expect(checkSelectedFileSize(mb(15), 10, true)).toBeNull();
  });

  it('still refuses an image too large to hand to the decoder', () => {
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB + 1), 10, true)).toEqual({
      key: 'fileUpload.errorTooLargeToDecode',
      values: { size: formatSizeMB(MAX_IMAGE_DECODE_MB) },
    });
  });

  it('accepts an image exactly at the decode ceiling', () => {
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB), 10, true)).toBeNull();
  });

  it('never applies a ceiling below the cap it is guarding', () => {
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB + 10), 200, true)).toBeNull();
  });
});

describe('checkUploadPayloadSize', () => {
  it('accepts a payload at or under the cap (the cap is inclusive)', () => {
    expect(checkUploadPayloadSize(mb(10), 10)).toBeNull();
    expect(checkUploadPayloadSize(0, 10)).toBeNull();
  });

  it('rejects a payload over the cap, naming the cap the way the UI shows it', () => {
    expect(checkUploadPayloadSize(mb(10) + 1, 10)).toEqual({
      key: 'fileUpload.errorTooLarge',
      values: { size: '10 MB' },
    });
    expect(checkUploadPayloadSize(mb(3000), 2048)).toEqual({
      key: 'fileUpload.errorTooLarge',
      values: { size: '2 GB' },
    });
  });
});
