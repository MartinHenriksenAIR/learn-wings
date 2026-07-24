import { describe, it, expect } from 'vitest';
import {
  computeDownscaleTarget,
  isDownscalableImageType,
  isStillWebp,
  maxEdgeForUpload,
  MAX_EDGE_BRANDING,
  MAX_EDGE_THUMBNAIL,
} from './image-downscale';

describe('computeDownscaleTarget', () => {
  it('scales a landscape image to the cap on its width', () => {
    expect(computeDownscaleTarget(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it('scales a portrait image to the cap on its height', () => {
    expect(computeDownscaleTarget(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it('scales a square image to the cap on both edges', () => {
    expect(computeDownscaleTarget(2048, 2048, 512)).toEqual({ width: 512, height: 512 });
  });

  it('returns null when the image is already under the cap', () => {
    expect(computeDownscaleTarget(800, 600, 1280)).toBeNull();
  });

  it('returns null when the longest edge is exactly at the cap', () => {
    expect(computeDownscaleTarget(1280, 720, 1280)).toBeNull();
    expect(computeDownscaleTarget(720, 1280, 1280)).toBeNull();
    expect(computeDownscaleTarget(512, 512, 512)).toBeNull();
  });

  it('returns null for a 1px image', () => {
    expect(computeDownscaleTarget(1, 1, 1280)).toBeNull();
  });

  it('never upscales — a small avatar is left alone', () => {
    expect(computeDownscaleTarget(200, 200, 512)).toBeNull();
    expect(computeDownscaleTarget(64, 32, 512)).toBeNull();
    expect(computeDownscaleTarget(1, 1, 512)).toBeNull();
  });

  it('returns null for zero dimensions', () => {
    expect(computeDownscaleTarget(0, 600, 1280)).toBeNull();
    expect(computeDownscaleTarget(800, 0, 1280)).toBeNull();
    expect(computeDownscaleTarget(0, 0, 1280)).toBeNull();
  });

  it('returns null for negative dimensions', () => {
    expect(computeDownscaleTarget(-4000, 3000, 1280)).toBeNull();
    expect(computeDownscaleTarget(4000, -3000, 1280)).toBeNull();
  });

  it('returns null for NaN dimensions', () => {
    expect(computeDownscaleTarget(NaN, 3000, 1280)).toBeNull();
    expect(computeDownscaleTarget(4000, NaN, 1280)).toBeNull();
  });

  it('returns null for infinite dimensions', () => {
    expect(computeDownscaleTarget(Infinity, 3000, 1280)).toBeNull();
    expect(computeDownscaleTarget(4000, Infinity, 1280)).toBeNull();
  });

  it('returns null for a non-positive or non-finite cap', () => {
    expect(computeDownscaleTarget(4000, 3000, 0)).toBeNull();
    expect(computeDownscaleTarget(4000, 3000, -512)).toBeNull();
    expect(computeDownscaleTarget(4000, 3000, NaN)).toBeNull();
    expect(computeDownscaleTarget(4000, 3000, Infinity)).toBeNull();
  });

  it('clamps the short edge to 1px rather than rounding it away', () => {
    expect(computeDownscaleTarget(20000, 1, 1280)).toEqual({ width: 1280, height: 1 });
    expect(computeDownscaleTarget(1, 20000, 1280)).toEqual({ width: 1, height: 1280 });
  });

  it('preserves aspect ratio to within a pixel of rounding', () => {
    const target = computeDownscaleTarget(4032, 3024, 1280);
    expect(target).not.toBeNull();
    const sourceRatio = 4032 / 3024;
    const targetRatio = target!.width / target!.height;
    expect(Math.abs(sourceRatio - targetRatio)).toBeLessThan(0.01);
  });

  it('produces integer dimensions', () => {
    const target = computeDownscaleTarget(3111, 2077, 512);
    expect(target).not.toBeNull();
    expect(Number.isInteger(target!.width)).toBe(true);
    expect(Number.isInteger(target!.height)).toBe(true);
  });

  it('pins the longest edge exactly to the cap', () => {
    expect(computeDownscaleTarget(5000, 137, 512)?.width).toBe(512);
    expect(computeDownscaleTarget(137, 5000, 512)?.height).toBe(512);
  });
});

describe('isDownscalableImageType', () => {
  it('accepts the formats we can decode and re-encode losslessly-in-kind', () => {
    expect(isDownscalableImageType('image/jpeg')).toBe(true);
    expect(isDownscalableImageType('image/png')).toBe(true);
    expect(isDownscalableImageType('image/webp')).toBe(true);
  });

  it('rejects GIF — canvas has no GIF encoder and animation would be lost', () => {
    expect(isDownscalableImageType('image/gif')).toBe(false);
  });

  it('rejects SVG — vector art must not be rasterised', () => {
    expect(isDownscalableImageType('image/svg+xml')).toBe(false);
  });

  it('rejects the non-standard image/jpg spelling', () => {
    expect(isDownscalableImageType('image/jpg')).toBe(false);
  });

  it('rejects non-image MIME types', () => {
    expect(isDownscalableImageType('application/pdf')).toBe(false);
    expect(isDownscalableImageType('video/mp4')).toBe(false);
    expect(isDownscalableImageType('text/plain')).toBe(false);
    expect(isDownscalableImageType('image')).toBe(false);
  });

  it('rejects a missing or empty type', () => {
    expect(isDownscalableImageType('')).toBe(false);
    expect(isDownscalableImageType(undefined)).toBe(false);
    expect(isDownscalableImageType(null)).toBe(false);
  });

  it('normalises casing and content-type parameters', () => {
    expect(isDownscalableImageType('IMAGE/PNG')).toBe(true);
    expect(isDownscalableImageType('  image/JPEG  ')).toBe(true);
    expect(isDownscalableImageType('image/jpeg; charset=binary')).toBe(true);
  });
});

describe('maxEdgeForUpload', () => {
  it('caps course thumbnails (image, no assetType) at 1280px', () => {
    expect(maxEdgeForUpload('image')).toBe(MAX_EDGE_THUMBNAIL);
    expect(maxEdgeForUpload('image', null)).toBe(MAX_EDGE_THUMBNAIL);
    expect(maxEdgeForUpload('image', undefined)).toBe(1280);
  });

  it('caps org logos and avatars at 512px', () => {
    expect(maxEdgeForUpload('image', 'org-logo')).toBe(MAX_EDGE_BRANDING);
    expect(maxEdgeForUpload('image', 'avatar')).toBe(512);
  });

  it('returns null for non-image uploads', () => {
    expect(maxEdgeForUpload('video')).toBeNull();
    expect(maxEdgeForUpload('document')).toBeNull();
  });
});

describe('isStillWebp', () => {
  /** Build a WebP-ish header: RIFF + size + WEBP + first chunk FourCC (+ VP8X flags). */
  function webpHeader(chunkFourCC: string, flags?: number): Uint8Array {
    const bytes = new Uint8Array(32);
    const write = (offset: number, ascii: string) => {
      for (let i = 0; i < ascii.length; i++) bytes[offset + i] = ascii.charCodeAt(i);
    };
    write(0, 'RIFF');
    write(8, 'WEBP');
    write(12, chunkFourCC);
    if (flags !== undefined) bytes[20] = flags;
    return bytes;
  }

  it('accepts a simple lossy still WebP (VP8 )', () => {
    expect(isStillWebp(webpHeader('VP8 '))).toBe(true);
  });

  it('accepts a simple lossless still WebP (VP8L)', () => {
    expect(isStillWebp(webpHeader('VP8L'))).toBe(true);
  });

  it('accepts an extended WebP with no animation bit set', () => {
    expect(isStillWebp(webpHeader('VP8X', 0x00))).toBe(true);
  });

  it('accepts an extended WebP carrying alpha but no animation', () => {
    // Alpha bit (0x10) set, animation bit (0x02) clear.
    expect(isStillWebp(webpHeader('VP8X', 0x10))).toBe(true);
  });

  it('rejects an animated WebP (VP8X animation bit set)', () => {
    expect(isStillWebp(webpHeader('VP8X', 0x02))).toBe(false);
    expect(isStillWebp(webpHeader('VP8X', 0x12))).toBe(false);
  });

  it('rejects a VP8X header truncated before the flags byte', () => {
    expect(isStillWebp(webpHeader('VP8X', 0x00).slice(0, 20))).toBe(false);
  });

  it('rejects an unknown first chunk', () => {
    expect(isStillWebp(webpHeader('XXXX'))).toBe(false);
  });

  it('rejects a non-RIFF container', () => {
    const bytes = webpHeader('VP8 ');
    bytes[0] = 'X'.charCodeAt(0);
    expect(isStillWebp(bytes)).toBe(false);
  });

  it('rejects a RIFF container that is not WEBP', () => {
    const bytes = webpHeader('VP8 ');
    bytes[8] = 'A'.charCodeAt(0);
    bytes[9] = 'V'.charCodeAt(0);
    bytes[10] = 'I'.charCodeAt(0);
    bytes[11] = ' '.charCodeAt(0);
    expect(isStillWebp(bytes)).toBe(false);
  });

  it('rejects a header too short to classify', () => {
    expect(isStillWebp(new Uint8Array(0))).toBe(false);
    expect(isStillWebp(new Uint8Array(15))).toBe(false);
  });
});
