/**
 * Client-side image downscaling for browser-direct blob uploads (#278).
 *
 * Images are uploaded straight from the browser to Azure Blob Storage, and the
 * app renders them small (course cards ~118px tall, org logos 36–64px, avatars
 * 36px). Storing and re-serving a 15 MB phone photo at full resolution costs
 * every learner who opens the course list. We shrink before the PUT.
 *
 * Design constraints, in priority order:
 *  1. An upload must NEVER fail because of this optimisation. Every step is
 *     wrapped so any missing API / decode error / encode error / encoder that
 *     never calls back falls back to uploading the original bytes untouched.
 *  2. The output MIME type is always identical to the input MIME type, and we
 *     only re-encode when the BYTES agree with that type (see `sniffImageType`).
 *     Together those preserve PNG transparency: a PNG is re-encoded as a PNG
 *     (lossless, alpha intact) rather than flattened onto a black JPEG
 *     background — org logos are frequently transparent PNGs, and they are
 *     exactly the asset people rename by hand. It also keeps the blob's
 *     extension, the `contentType` negotiated with /api/azure-upload-url, and
 *     the stored path all consistent with today's behaviour.
 *  3. We never upscale, and we never upload a re-encode that came out *larger*
 *     than the original (common for small PNGs, where the source encoder beat
 *     the browser's).
 *
 * The decision logic here is pure and exhaustively unit-tested. The canvas work
 * lives in a thin shim at the bottom of the file; jsdom implements no Canvas
 * API, so `image-downscale.test.ts` drives that shim through stubbed
 * `getContext`/`toBlob` prototypes rather than a real encoder.
 */

/** Longest-edge cap for course thumbnails. Card art, never shown large. */
export const MAX_EDGE_THUMBNAIL = 1280;

/** Longest-edge cap for org logos and user avatars. Rendered at 36–64 px. */
export const MAX_EDGE_BRANDING = 512;

/** Encode quality for lossy formats. Visually transparent at these sizes. */
const ENCODE_QUALITY = 0.85;

/**
 * Bytes of file header read for the magic-number sniff. 32 covers every
 * signature below and reaches the WebP VP8X flags byte at offset 20.
 */
const HEADER_SNIFF_BYTES = 32;

/** VP8X flags-byte mask for the "has animation" bit. */
const VP8X_ANIMATION_FLAG = 0x02;

/**
 * Wall-clock budget for one decode and one encode.
 *
 * Neither `createImageBitmap` nor `toBlob` is guaranteed to settle: an encoder
 * that runs out of memory on a large canvas can simply never invoke its
 * callback. Without a bound the awaiting upload handler never reaches its
 * `finally`, so the spinner spins forever and the file input is never reset —
 * the control is unusable until the page is reloaded. Generous enough that a
 * slow phone finishes well inside it; short enough to be a hiccup, not a brick.
 */
const DECODE_TIMEOUT_MS = 15_000;
const ENCODE_TIMEOUT_MS = 15_000;

/** The kinds of upload a call site can ask for; `FileUpload`'s `accept` prop. */
export type UploadAccept = 'image' | 'video' | 'document';

/** Mirrors FileUpload's `assetType` prop — the branding-container assets. */
export type BrandingAssetType = 'org-logo' | 'avatar';

/**
 * Formats we re-encode.
 *
 * `image/gif` is deliberately absent: no browser implements a GIF encoder for
 * `canvas.toBlob()` (it silently substitutes PNG), and a canvas decode only ever
 * sees frame 1, so processing an animated GIF would destroy the animation.
 * Anything not listed — including `image/svg+xml` (vector: resolution-independent
 * and rasterising it would be a downgrade) and the non-standard `image/jpg` —
 * is uploaded untouched.
 */
const DOWNSCALABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Formats where the `quality` argument to `toBlob` is meaningful. */
const LOSSY_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/webp']);

/** The full 8-byte PNG signature. */
const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG start-of-image followed by the first marker byte. */
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

export interface DownscaleTarget {
  width: number;
  height: number;
}

/**
 * Normalise a `File.type` for lookup: browsers may report casing variants or
 * append parameters (`image/jpeg; charset=binary`).
 */
export function normalizeMimeType(mimeType: string | null | undefined): string {
  if (typeof mimeType !== 'string') return '';
  return mimeType.split(';')[0].trim().toLowerCase();
}

/**
 * True when this MIME type is one we can safely decode, resize and re-encode
 * without changing the format or losing information the source carried.
 */
export function isDownscalableImageType(mimeType: string | null | undefined): boolean {
  return DOWNSCALABLE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

/**
 * The longest-edge cap for a given FileUpload call site, or `null` when the
 * upload is not a downscalable image at all.
 *
 * `assetType` is the existing prop that already distinguishes branding assets
 * (org logos, avatars → public branding container) from everything else, so it
 * doubles as the size-class selector: present → 512 px, absent + image → 1280 px
 * (course thumbnails, the only other image call sites). Videos and documents
 * are never processed.
 */
export function maxEdgeForUpload(
  accept: UploadAccept,
  assetType?: BrandingAssetType | null,
): number | null {
  if (accept !== 'image') return null;
  return assetType ? MAX_EDGE_BRANDING : MAX_EDGE_THUMBNAIL;
}

/**
 * Target dimensions for a downscale, or `null` when no downscale should happen.
 *
 * Returns `null` for: dimensions already within the cap (including exactly at
 * it — re-encoding would only lose quality), and any non-finite or non-positive
 * input. Because the "already within the cap" check comes first, this can never
 * upscale: a 200 px avatar stays 200 px.
 *
 * Aspect ratio is preserved; the short edge is clamped to a minimum of 1 px so
 * an extreme panorama can't round down to a zero-height canvas.
 */
export function computeDownscaleTarget(
  width: number,
  height: number,
  maxEdge: number,
): DownscaleTarget | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return null;

  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) return null;

  const scale = maxEdge / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The image format the BYTES declare, or null for anything we don't re-encode.
 *
 * `File.type` is not evidence about content. Browsers derive it from the
 * filename extension (Windows registry / macOS UTI), never from the payload, so
 * `logo.jpg` holding PNG-with-alpha bytes reports `image/jpeg`. That mismatch is
 * harmless while the bytes are passed through untouched — every browser
 * content-sniffs an `<img>` regardless of the declared type, so the logo renders
 * transparent — but it is fatal once we re-encode: the decode succeeds (sniffed),
 * we draw the transparent image onto the canvas, and `toBlob(…, 'image/jpeg')`
 * composites the alpha onto solid black, which the HTML spec MANDATES for a
 * format with no alpha channel. `blob.type` then matches `file.type`, so the
 * substitution guard waves it through and the logo is stored with a permanent
 * black box behind it.
 *
 * So the declared type only earns the right to be re-encoded once these bytes
 * agree with it; on any disagreement the caller uploads the original untouched.
 *
 * Signatures: PNG's full 8-byte signature, JPEG's SOI plus the first marker
 * byte, and WebP's RIFF container (`RIFF` + 4-byte size + `WEBP`).
 */
export function sniffImageType(header: Uint8Array): string | null {
  if (startsWithBytes(header, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(header, JPEG_SIGNATURE)) return 'image/jpeg';
  if (header.length >= 12 && readAscii(header, 0, 4) === 'RIFF' && readAscii(header, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * True only when `header` positively identifies a *still* (non-animated) WebP.
 *
 * WebP is a RIFF container: `RIFF` + size + `WEBP` + a first chunk FourCC.
 * `VP8 `/`VP8L` are the simple still formats. `VP8X` is the extended format,
 * whose flags byte (offset 20) carries the animation bit. Anything we can't
 * positively recognise returns false, so we leave the file alone rather than
 * risk flattening an animation to a single frame.
 */
export function isStillWebp(header: Uint8Array): boolean {
  if (header.length < 16) return false;
  if (readAscii(header, 0, 4) !== 'RIFF') return false;
  if (readAscii(header, 8, 4) !== 'WEBP') return false;

  const chunkFourCC = readAscii(header, 12, 4);
  if (chunkFourCC === 'VP8 ' || chunkFourCC === 'VP8L') return true;
  if (chunkFourCC !== 'VP8X') return false;

  // VP8X: FourCC(4) + chunk size(4) + flags(1) — flags is at offset 20.
  if (header.length < 21) return false;
  return (header[20] & VP8X_ANIMATION_FLAG) === 0;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

// Everything below touches the Canvas API, which jsdom does not implement. The
// unit tests drive it through stubbed `getContext`/`toBlob` prototypes;
// file-upload.test.tsx covers the fail-open paths as the component sees them.

/**
 * Downscale `file` so its longest edge is at most `maxEdge`, returning a new
 * `File` with the same name and MIME type. Returns the ORIGINAL file unchanged
 * whenever downscaling is impossible, unnecessary, unprofitable or unsafe — this
 * function never throws and never rejects.
 *
 * Decoding goes through `createImageBitmap(..., { imageOrientation: 'from-image' })`
 * rather than an `<img>` element on purpose. Re-encoding a canvas drops EXIF, so
 * a bare `<img>` decode would bake in *unrotated* pixels and leave an
 * EXIF-rotated phone photo displayed sideways — strictly worse than today, where
 * the raw file keeps its EXIF. `from-image` applies the orientation to the
 * pixels before we draw, so the result matches what the browser shows today.
 *
 * Three things can go wrong with that option, and all three bail:
 *  · no `createImageBitmap` at all → bail;
 *  · an engine that rejects `'from-image'` as an unknown enum value → it throws,
 *    which is caught → bail;
 *  · an engine whose `ImageBitmapOptions` dictionary simply LACKS
 *    `imageOrientation` → WebIDL drops unknown dictionary members silently, so
 *    nothing throws and the bitmap comes back unrotated. `decodeBitmap` detects
 *    this directly, by observing whether the member was read (see there).
 */
export async function downscaleImageFile(file: File, maxEdge: number): Promise<File> {
  try {
    const declaredType = normalizeMimeType(file.type);
    if (!isDownscalableImageType(declaredType)) return file;
    if (typeof globalThis.createImageBitmap !== 'function') return file;

    const header = await readHeaderBytes(file);
    if (!header) return file;
    // Re-encoding is only safe when the bytes really are the format the
    // filename claims — see sniffImageType for what a mismatch costs.
    if (sniffImageType(header) !== declaredType) return file;
    // A canvas decode only ever sees frame 1 of an animation.
    if (declaredType === 'image/webp' && !isStillWebp(header)) return file;

    const decoded = await decodeBitmap(file);
    if (!decoded) return file;
    const { bitmap, orientationApplied } = decoded;

    try {
      // An unrotated decode would store a portrait phone photo sideways, which
      // is worse than the status quo (where the original keeps its EXIF).
      if (!orientationApplied) return file;

      const target = computeDownscaleTarget(bitmap.width, bitmap.height, maxEdge);
      if (!target) return file;

      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);

      const blob = await canvasToBlob(canvas, file.type);
      if (!blob) return file;
      // A browser without an encoder for this type silently substitutes PNG.
      // Uploading PNG bytes under the original content type would corrupt the
      // asset, so only accept a blob that came back in the format we asked for.
      if (normalizeMimeType(blob.type) !== declaredType) return file;
      // Re-encoding small images often inflates them; keep whichever is smaller.
      if (blob.size >= file.size) return file;

      return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    } finally {
      // Freeing the decoded bitmap must not be able to discard a good result.
      closeBitmap(bitmap);
    }
  } catch {
    // Fail open: any unexpected failure uploads the original bytes.
    return file;
  }
}

/** Read just enough of the file to identify its format, or null if unreadable. */
async function readHeaderBytes(file: File): Promise<Uint8Array | null> {
  try {
    const header = await file.slice(0, HEADER_SNIFF_BYTES).arrayBuffer();
    return new Uint8Array(header);
  } catch {
    return null;
  }
}

/**
 * Decode `file` with EXIF orientation applied, reporting whether the engine
 * actually honoured the request.
 *
 * `imageOrientation` is passed as a GETTER rather than a plain value so we can
 * observe the WebIDL dictionary conversion: converting an `ImageBitmapOptions`
 * argument performs a [[Get]] for every member the implementation declares, and
 * for no others. So a getter that never fires means this engine's dictionary has
 * no `imageOrientation` member and quietly ignored ours — the same technique as
 * the classic `addEventListener` "passive" probe.
 *
 * Preferred over decoding a fabricated 1×2 EXIF-Orientation-6 JPEG and checking
 * the reported width: this asks the engine the exact question (is the member
 * declared?), needs no hand-crafted test image or async warm-up, and its only
 * failure mode is a false negative, which merely uploads the original untouched.
 */
async function decodeBitmap(
  file: File,
): Promise<{ bitmap: ImageBitmap; orientationApplied: boolean } | null> {
  let orientationApplied = false;
  const options = {
    get imageOrientation() {
      orientationApplied = true;
      return 'from-image' as const;
    },
  } as ImageBitmapOptions;

  let decode: Promise<ImageBitmap>;
  try {
    decode = globalThis.createImageBitmap(file, options);
  } catch {
    // An engine that rejects the orientation enum throws during conversion.
    return null;
  }

  const bitmap = await settleWithin(decode, DECODE_TIMEOUT_MS, closeBitmap);
  if (!bitmap) return null;
  return { bitmap, orientationApplied };
}

/**
 * `promise`'s value, or null if it rejects or has not settled within `ms`.
 * A value that arrives after the timeout is handed to `onLate` for disposal,
 * so an abandoned decode cannot leak its bitmap.
 */
function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  onLate?: (value: T) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) onLate?.(value);
        else resolve(value);
      },
      () => {
        clearTimeout(timer);
        if (!timedOut) resolve(null);
      },
    );
  });
}

/** Release a decoded bitmap; older engines may not expose `close()`. */
function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    /* the GC will handle it */
  }
}

/**
 * Promise wrapper for `canvas.toBlob`, resolving `null` instead of throwing —
 * and resolving `null` rather than hanging if the callback never comes.
 */
function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(blob);
    };
    const timer = setTimeout(() => settle(null), ENCODE_TIMEOUT_MS);
    const quality = LOSSY_MIME_TYPES.has(normalizeMimeType(mimeType)) ? ENCODE_QUALITY : undefined;
    try {
      canvas.toBlob((blob) => settle(blob), mimeType, quality);
    } catch {
      settle(null);
    }
  });
}
