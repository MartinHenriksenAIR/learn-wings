import { describe, it, expect } from 'vitest';
import {
  BYTES_PER_MB,
  MAX_IMAGE_DECODE_MB,
  UPLOAD_MAX_MB,
  checkSelectedFileSize,
  checkUploadPayloadSize,
  effectiveMaxSizeMB,
  formatSizeMB,
  willDownscale,
} from './upload-limits';

const mb = (n: number) => n * BYTES_PER_MB;

describe('UPLOAD_MAX_MB', () => {
  // These mirror functions/shared/upload-limits.ts. If that file changes and
  // this does not, the UI starts advertising a limit the server would 413 on.
  it('mirrors the server caps: video 2 GB, document 100 MB, image 10 MB', () => {
    expect(UPLOAD_MAX_MB.video).toBe(2048);
    expect(UPLOAD_MAX_MB.document).toBe(100);
    expect(UPLOAD_MAX_MB.image).toBe(10);
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
    // The old FileUpload default was 50 MB against a 10 MB server cap — exactly
    // the disagreement this clamp exists to make impossible.
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
    // Animated GIFs would lose their animation; SVG is resolution-independent.
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
    expect(checkSelectedFileSize(mb(101), 100, false)).toBe('File size must be less than 100 MB');
  });

  it('lets an over-cap image through to the downscaler instead of refusing it', () => {
    // The headline case of #278: a 20 MB phone photo with a 10 MB cap must be
    // shrunk, not rejected. Rejecting here is what this reorder fixes.
    expect(checkSelectedFileSize(mb(20), 10, true)).toBeNull();
  });

  it('still refuses an image too large to hand to the decoder', () => {
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB + 1), 10, true)).toBe(
      `Image is too large to process. Choose a file under ${formatSizeMB(MAX_IMAGE_DECODE_MB)}.`,
    );
  });

  it('accepts an image exactly at the decode ceiling', () => {
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB), 10, true)).toBeNull();
  });

  it('never applies a ceiling below the cap it is guarding', () => {
    // A hypothetical cap above the ceiling must not make the gate stricter.
    expect(checkSelectedFileSize(mb(MAX_IMAGE_DECODE_MB + 10), 200, true)).toBeNull();
  });
});

describe('checkUploadPayloadSize', () => {
  it('accepts a payload at or under the cap (the cap is inclusive)', () => {
    expect(checkUploadPayloadSize(mb(10), 10)).toBeNull();
    expect(checkUploadPayloadSize(0, 10)).toBeNull();
  });

  it('rejects a payload over the cap, naming the cap the way the UI shows it', () => {
    expect(checkUploadPayloadSize(mb(10) + 1, 10)).toBe('File size must be less than 10 MB');
    expect(checkUploadPayloadSize(mb(3000), 2048)).toBe('File size must be less than 2 GB');
  });
});
