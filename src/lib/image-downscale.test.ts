import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeDownscaleTarget,
  downscaleImageFile,
  isDownscalableImageType,
  isStillWebp,
  maxEdgeForUpload,
  sniffImageType,
  MAX_EDGE_BRANDING,
  MAX_EDGE_THUMBNAIL,
} from './image-downscale';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

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

  it('rounds awkward ratios to exact, integral dimensions', () => {
    // Exact expected values, not "is it an integer?" — Math.round can only ever
    // return an integer, so that assertion could never fail. What is worth
    // pinning is the rounding itself: 2077 × 512/3111 = 341.83 → 342.
    expect(computeDownscaleTarget(3111, 2077, 512)).toEqual({ width: 512, height: 342 });
    expect(computeDownscaleTarget(1999, 1001, 1280)).toEqual({ width: 1280, height: 641 });
    expect(computeDownscaleTarget(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
  });

  it('preserves aspect ratio to within the rounding of a single pixel', () => {
    const target = computeDownscaleTarget(3111, 2077, 512);
    expect(target).not.toBeNull();
    const sourceRatio = 3111 / 2077;
    const targetRatio = target!.width / target!.height;
    // Each edge moves by at most half a pixel, so the ratio moves by at most
    // one short-edge pixel's worth of it — far tighter than a flat 0.01.
    expect(Math.abs(sourceRatio - targetRatio)).toBeLessThanOrEqual(sourceRatio / target!.height);
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

describe('sniffImageType', () => {
  const bytes = (magic: readonly number[], length = 32) => {
    const out = new Uint8Array(length);
    out.set(magic, 0);
    return out;
  };

  it('identifies the three formats we re-encode', () => {
    expect(sniffImageType(bytes(PNG_MAGIC))).toBe('image/png');
    expect(sniffImageType(bytes(JPEG_MAGIC))).toBe('image/jpeg');
    expect(sniffImageType(webpHeader('VP8 '))).toBe('image/webp');
    expect(sniffImageType(webpHeader('VP8X', 0x02))).toBe('image/webp');
  });

  it('requires the FULL png signature, not just the first bytes', () => {
    // 89 50 4E 47 alone is not conclusive; the four trailing bytes catch a
    // truncated or deliberately-crafted header.
    expect(sniffImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  it('returns null for formats we never re-encode', () => {
    expect(sniffImageType(bytes(GIF_MAGIC))).toBeNull();
    // '<svg' — text, not a binary signature.
    expect(sniffImageType(bytes([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it('returns null for a RIFF container that is not WebP (e.g. AVI)', () => {
    const avi = webpHeader('VP8 ');
    avi.set([0x41, 0x56, 0x49, 0x20], 8); // 'AVI '
    expect(sniffImageType(avi)).toBeNull();
  });

  it('returns null for empty or truncated headers rather than guessing', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(new Uint8Array(PNG_MAGIC.slice(0, 4)))).toBeNull();
    // 'RIFF' with nothing after it cannot be confirmed as WebP.
    expect(sniffImageType(bytes([0x52, 0x49, 0x46, 0x46], 8))).toBeNull();
  });
});

// The canvas shim — the only part of this module that can CHANGE the bytes a
// user uploads, and therefore the only part that can corrupt an image. jsdom
// implements no Canvas API, but it does not need to: `getContext` and `toBlob`
// are stubbed on the prototype (the same technique file-upload.test.tsx already
// uses for getContext), which makes every branch below assertable without
// pulling in a native canvas dependency.
describe('downscaleImageFile (canvas shim)', () => {
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  let drawImage: ReturnType<typeof vi.fn>;
  let toBlob: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          drawImage,
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
        }) as unknown as CanvasRenderingContext2D,
    );
    toBlob = vi.fn();
    HTMLCanvasElement.prototype.toBlob = toBlob as unknown as HTMLCanvasElement['toBlob'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    HTMLCanvasElement.prototype.toBlob = realToBlob;
  });

  /** A file whose BYTES start with `magic`, padded out to `size`. */
  function imageFile(name: string, type: string, magic: readonly number[], size = 40_000): File {
    const data = new Uint8Array(size);
    data.set(magic, 0);
    return new File([data], name, { type, lastModified: 1_700_000_000_000 });
  }

  /** A WebP file whose header declares `chunkFourCC` (and VP8X `flags`). */
  function webpFile(name: string, chunkFourCC: string, flags?: number, size = 40_000): File {
    const data = new Uint8Array(size);
    data.set(webpHeader(chunkFourCC, flags), 0);
    return new File([data], name, { type: 'image/webp', lastModified: 1_700_000_000_000 });
  }

  /**
   * A `createImageBitmap` that behaves like an engine which SUPPORTS
   * `imageOrientation`: WebIDL dictionary conversion performs a [[Get]] for
   * every member the engine declares, so a supporting engine reads the option
   * exactly as this stub does.
   */
  function stubDecoder(width: number, height: number) {
    const close = vi.fn();
    const decode = vi.fn((_source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      void options?.imageOrientation;
      return Promise.resolve({ width, height, close } as unknown as ImageBitmap);
    });
    vi.stubGlobal('createImageBitmap', decode);
    return { decode, close };
  }

  /** Make `toBlob` answer with a blob of the given type and size. */
  function encodeAs(type: string, size: number) {
    toBlob.mockImplementation((callback: BlobCallback) => {
      queueMicrotask(() => callback(new Blob([new Uint8Array(size)], { type })));
    });
  }

  describe('a successful re-encode', () => {
    it('produces a smaller File that keeps the name, type and lastModified', async () => {
      const { decode, close } = stubDecoder(4000, 3000);
      encodeAs('image/png', 1_000);
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      const result = await downscaleImageFile(file, 1280);

      expect(result).not.toBe(file);
      expect(result.name).toBe('logo.png');
      expect(result.type).toBe('image/png');
      expect(result.lastModified).toBe(1_700_000_000_000);
      expect(result.size).toBe(1_000);
      expect(decode).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalled();
    });

    it('draws at the computed target size — a PNG stays a PNG', async () => {
      stubDecoder(4000, 3000);
      encodeAs('image/png', 1_000);

      await downscaleImageFile(imageFile('logo.png', 'image/png', PNG_MAGIC), 1280);

      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 960);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    });

    it('asks for quality only where the format is lossy', async () => {
      stubDecoder(4000, 3000);
      encodeAs('image/jpeg', 1_000);

      await downscaleImageFile(imageFile('photo.jpg', 'image/jpeg', JPEG_MAGIC), 1280);

      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    });

    it('re-encodes a still WebP', async () => {
      stubDecoder(4000, 3000);
      encodeAs('image/webp', 1_000);

      const file = webpFile('art.webp', 'VP8L');
      const result = await downscaleImageFile(file, 1280);

      expect(result).not.toBe(file);
      expect(result.type).toBe('image/webp');
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.85);
    });
  });

  // `File.type` is derived from the FILENAME by every browser (Windows registry
  // / macOS UTI), never from the bytes. Re-encoding on that word alone flattens
  // a transparent PNG named .jpg onto solid black — the HTML spec mandates the
  // compositing, and `blob.type === file.type` then waves the result through.
  describe('the declared type must agree with the bytes', () => {
    it('leaves PNG bytes wearing a .jpg name completely alone', async () => {
      const { decode } = stubDecoder(4000, 3000);
      encodeAs('image/jpeg', 1_000);
      const file = imageFile('logo.jpg', 'image/jpeg', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
      expect(drawImage).not.toHaveBeenCalled();
      expect(toBlob).not.toHaveBeenCalled();
    });

    it('leaves JPEG bytes wearing a .png name alone', async () => {
      const { decode } = stubDecoder(4000, 3000);
      encodeAs('image/png', 1_000);
      const file = imageFile('photo.png', 'image/png', JPEG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
    });

    it('leaves a GIF renamed .png alone', async () => {
      const { decode } = stubDecoder(4000, 3000);
      encodeAs('image/png', 1_000);
      const file = imageFile('anim.png', 'image/png', GIF_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
    });

    it('leaves bytes with no recognisable signature alone', async () => {
      const { decode } = stubDecoder(4000, 3000);
      const file = imageFile('empty.png', 'image/png', []);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
    });
  });

  describe('the still-WebP guard is wired into the decode path', () => {
    it('leaves an animated WebP untouched', async () => {
      const { decode } = stubDecoder(4000, 3000);
      encodeAs('image/webp', 1_000);
      const file = webpFile('anim.webp', 'VP8X', 0x02);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
    });

    it('leaves a WebP whose first chunk it cannot classify untouched', async () => {
      const { decode } = stubDecoder(4000, 3000);
      const file = webpFile('odd.webp', 'XXXX');

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).not.toHaveBeenCalled();
    });
  });

  describe('the encoder is not trusted to answer in kind', () => {
    it('keeps the original when the encoder substitutes another format', async () => {
      stubDecoder(4000, 3000);
      // No WebP encoder → the browser silently hands back PNG bytes. Uploading
      // them under the original content type would corrupt the asset.
      encodeAs('image/png', 1_000);
      const file = webpFile('art.webp', 'VP8L');

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(toBlob).toHaveBeenCalled();
    });

    it('keeps the original when the re-encode came out no smaller', async () => {
      stubDecoder(4000, 3000);
      encodeAs('image/png', 40_000); // exactly equal — the rule is `>=`
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC, 40_000);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when the re-encode came out larger', async () => {
      stubDecoder(4000, 3000);
      encodeAs('image/png', 90_000);
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC, 40_000);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when toBlob yields nothing', async () => {
      stubDecoder(4000, 3000);
      toBlob.mockImplementation((callback: BlobCallback) => queueMicrotask(() => callback(null)));
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when toBlob throws', async () => {
      stubDecoder(4000, 3000);
      toBlob.mockImplementation(() => {
        throw new Error('encoder exploded');
      });
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when the browser has no toBlob at all', async () => {
      stubDecoder(4000, 3000);
      delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).toBlob;
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });
  });

  // WebIDL drops dictionary members an implementation does not declare, without
  // error — so an engine lacking `imageOrientation` returns an UNROTATED bitmap
  // and nothing throws. Re-encoding that would store a portrait phone photo
  // (EXIF Orientation=6, very common) rotated 90°, which is worse than the
  // status quo where the original file keeps its EXIF.
  describe('EXIF orientation', () => {
    it('asks for from-image orientation', async () => {
      const { decode } = stubDecoder(4000, 3000);
      encodeAs('image/png', 1_000);

      await downscaleImageFile(imageFile('logo.png', 'image/png', PNG_MAGIC), 1280);

      expect(decode.mock.calls[0][1]?.imageOrientation).toBe('from-image');
    });

    it('keeps the original when the engine silently ignores the option', async () => {
      const close = vi.fn();
      // An engine whose ImageBitmapOptions dictionary lacks the member never
      // reads it — no throw, no rotation.
      const decode = vi.fn(() =>
        Promise.resolve({ width: 4000, height: 3000, close } as unknown as ImageBitmap),
      );
      vi.stubGlobal('createImageBitmap', decode);
      encodeAs('image/png', 1_000);
      const file = imageFile('photo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).toHaveBeenCalledTimes(1);
      expect(drawImage).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    });

    it('keeps the original when the engine rejects the option outright', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(() => {
          throw new TypeError("'from-image' is not a valid enum value");
        }),
      );
      const file = imageFile('photo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });
  });

  // An upload must never fail because of this optimisation — and "never fail"
  // includes never hanging. A `toBlob` whose callback is simply never invoked
  // would otherwise leave the caller's `await` unsettled forever: the spinner
  // spins, the file input is never reset, and the control is dead until reload.
  describe('neither step may hang', () => {
    /**
     * Fire the timeouts the shim armed, without a clock.
     *
     * Fake timers are the wrong tool here: the header sniff resolves through
     * jsdom's FileReader, so the timeout under test is not armed until several
     * real event-loop turns after the call — and a faked clock advanced before
     * that finds nothing to advance. Capturing the callbacks instead is both
     * deterministic and a stronger assertion: it proves a timeout was ARMED,
     * which is the whole fix.
     */
    async function fireArmedTimeouts(pending: Promise<File>): Promise<File> {
      const realSetTimeout = globalThis.setTimeout;
      const armed: Array<() => void> = [];
      let armedCount = 0;
      let settled = false;
      const result = pending.then((file) => {
        settled = true;
        return file;
      });

      const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        callback: () => void,
        ms?: number,
      ) => {
        // Only the shim's own budgets are intercepted; jsdom schedules its
        // FileReader events on short timers that must still fire normally.
        if (typeof ms === 'number' && ms >= 1_000) {
          armed.push(callback);
          armedCount += 1;
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(callback, ms);
      }) as unknown as typeof setTimeout);

      for (let i = 0; i < 100 && !settled; i++) {
        await new Promise((resolve) => realSetTimeout(resolve, 0));
        while (armed.length) armed.shift()!();
      }
      spy.mockRestore();

      // The point of the fix: something WAS armed. Without it the promise
      // could only settle by hanging forever.
      expect(armedCount).toBeGreaterThan(0);
      return result;
    }

    it('gives up on an encoder that never calls back', async () => {
      stubDecoder(4000, 3000);
      toBlob.mockImplementation(() => {
        /* callback never invoked */
      });
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await fireArmedTimeouts(downscaleImageFile(file, 1280))).toBe(file);
      expect(toBlob).toHaveBeenCalled();
    });

    it('gives up on a decoder that never settles', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(() => new Promise<ImageBitmap>(() => {})),
      );
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await fireArmedTimeouts(downscaleImageFile(file, 1280))).toBe(file);
      expect(drawImage).not.toHaveBeenCalled();
    });
  });

  describe('everything else fails open', () => {
    it('keeps the original when the browser cannot decode images at all', async () => {
      expect(typeof globalThis.createImageBitmap).not.toBe('function');
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when the decode rejects', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(() => Promise.reject(new Error('corrupt image'))),
      );
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('keeps the original when the image is already within the cap', async () => {
      const { decode, close } = stubDecoder(800, 600);
      const file = imageFile('small.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(decode).toHaveBeenCalledTimes(1);
      expect(drawImage).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    });

    it('keeps the original when there is no 2D context', async () => {
      const { close } = stubDecoder(4000, 3000);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
      expect(close).toHaveBeenCalled();
    });

    it('keeps the original when the canvas itself throws', async () => {
      stubDecoder(4000, 3000);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        throw new Error('canvas unavailable');
      });
      const file = imageFile('logo.png', 'image/png', PNG_MAGIC);

      expect(await downscaleImageFile(file, 1280)).toBe(file);
    });

    it('never processes a non-downscalable type, whatever its bytes say', async () => {
      const { decode } = stubDecoder(4000, 3000);
      const gif = imageFile('anim.gif', 'image/gif', GIF_MAGIC);

      expect(await downscaleImageFile(gif, 1280)).toBe(gif);
      expect(decode).not.toHaveBeenCalled();
    });
  });
});
