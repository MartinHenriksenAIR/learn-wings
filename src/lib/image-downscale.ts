/**
 * Client-side image downscaling for browser-direct blob uploads (#278).
 *
 * Images are uploaded straight from the browser to Azure Blob Storage, and the
 * app renders them small (course cards ~118px tall, org logos 36–64px, avatars
 * 36px). Storing and re-serving a 20 MB phone photo at full resolution costs
 * every learner who opens the course list. We shrink before the PUT.
 *
 * Design constraints, in priority order:
 *  1. An upload must NEVER fail because of this optimisation. Every step is
 *     wrapped so any missing API / decode error / encode error falls back to
 *     uploading the original bytes untouched.
 *  2. The output MIME type is always identical to the input MIME type. That is
 *     what preserves PNG transparency: a PNG is re-encoded as a PNG (lossless,
 *     alpha intact) rather than flattened onto a black JPEG background — org
 *     logos are frequently transparent PNGs. It also keeps the blob's extension,
 *     the `contentType` negotiated with /api/azure-upload-url, and the stored
 *     path all consistent with today's behaviour.
 *  3. We never upscale, and we never upload a re-encode that came out *larger*
 *     than the original (common for small PNGs, where the source encoder beat
 *     the browser's).
 *
 * The decision logic here is pure and exhaustively unit-tested. The canvas work
 * lives in a thin shim at the bottom of the file which the unit tests do not
 * execute (jsdom has no Canvas API).
 */

/** Longest-edge cap for course thumbnails. Card art, never shown large. */
export const MAX_EDGE_THUMBNAIL = 1280;

/** Longest-edge cap for org logos and user avatars. Rendered at 36–64 px. */
export const MAX_EDGE_BRANDING = 512;

/** Encode quality for lossy formats. Visually transparent at these sizes. */
export const ENCODE_QUALITY = 0.85;

/** Bytes of file header the WebP animation sniff needs (flags byte is at 20). */
export const WEBP_HEADER_BYTES = 32;

/** VP8X flags-byte mask for the "has animation" bit. */
const VP8X_ANIMATION_FLAG = 0x02;

/** Mirrors FileUpload's `accept` prop. */
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

export interface DownscaleTarget {
  width: number;
  height: number;
}

/**
 * Normalise a `File.type` for lookup: browsers may report casing variants or
 * append parameters (`image/jpeg; charset=binary`).
 */
function normalizeMimeType(mimeType: string | null | undefined): string {
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

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

// ─── Canvas shim ─────────────────────────────────────────────────────────────
// Everything below touches the Canvas API, which jsdom does not implement. The
// unit tests exercise the pure helpers above; file-upload.test.tsx covers the
// fail-open paths that ARE reachable in jsdom.

/**
 * Downscale `file` so its longest edge is at most `maxEdge`, returning a new
 * `File` with the same name and MIME type. Returns the ORIGINAL file unchanged
 * whenever downscaling is impossible, unnecessary, or unprofitable — this
 * function never throws and never rejects.
 *
 * Decoding goes through `createImageBitmap(..., { imageOrientation: 'from-image' })`
 * rather than an `<img>` element on purpose. Re-encoding a canvas drops EXIF, so
 * a bare `<img>` decode would bake in *unrotated* pixels and leave an
 * EXIF-rotated phone photo displayed sideways — strictly worse than today, where
 * the raw file keeps its EXIF. `from-image` applies the orientation to the
 * pixels before we draw, so the result matches what the browser shows today. If
 * the browser lacks `createImageBitmap` (or rejects the option), we bail and
 * upload the original, so orientation is never made worse than the status quo.
 */
export async function downscaleImageFile(file: File, maxEdge: number): Promise<File> {
  try {
    if (!isDownscalableImageType(file.type)) return file;
    if (normalizeMimeType(file.type) === 'image/webp' && !(await isStillWebpFile(file))) {
      return file;
    }
    if (typeof globalThis.createImageBitmap !== 'function') return file;

    let bitmap: ImageBitmap;
    try {
      bitmap = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Undecodable image, or a browser that rejects the orientation option.
      return file;
    }

    try {
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
      if (normalizeMimeType(blob.type) !== normalizeMimeType(file.type)) return file;
      // Re-encoding small images often inflates them; keep whichever is smaller.
      if (blob.size >= file.size) return file;

      return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    } finally {
      // Freeing the decoded bitmap must not be able to discard a good result.
      try {
        bitmap.close();
      } catch {
        /* older engines may not expose close(); the GC will handle it */
      }
    }
  } catch {
    // Fail open: any unexpected failure uploads the original bytes.
    return file;
  }
}

/** Read just enough of a WebP file to tell a still image from an animation. */
async function isStillWebpFile(file: File): Promise<boolean> {
  try {
    const header = await file.slice(0, WEBP_HEADER_BYTES).arrayBuffer();
    return isStillWebp(new Uint8Array(header));
  } catch {
    return false;
  }
}

/** Promise wrapper for `canvas.toBlob`, resolving `null` instead of throwing. */
function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    const quality = LOSSY_MIME_TYPES.has(normalizeMimeType(mimeType)) ? ENCODE_QUALITY : undefined;
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}
