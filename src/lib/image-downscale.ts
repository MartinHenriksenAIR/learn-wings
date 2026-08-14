export const MAX_EDGE_THUMBNAIL = 1280;

export const MAX_EDGE_BRANDING = 512;

const ENCODE_QUALITY = 0.85;

const HEADER_SNIFF_BYTES = 32;

const VP8X_ANIMATION_FLAG = 0x02;

const DECODE_TIMEOUT_MS = 15_000;
const ENCODE_TIMEOUT_MS = 15_000;

export type UploadAccept = 'image' | 'video' | 'document';

export type BrandingAssetType = 'org-logo' | 'avatar';

const DOWNSCALABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const LOSSY_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/webp']);

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

export interface DownscaleTarget {
  width: number;
  height: number;
}

export function normalizeMimeType(mimeType: string | null | undefined): string {
  if (typeof mimeType !== 'string') return '';
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isDownscalableImageType(mimeType: string | null | undefined): boolean {
  return DOWNSCALABLE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

export function maxEdgeForUpload(
  accept: UploadAccept,
  assetType?: BrandingAssetType | null,
): number | null {
  if (accept !== 'image') return null;
  return assetType ? MAX_EDGE_BRANDING : MAX_EDGE_THUMBNAIL;
}

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

export function sniffImageType(header: Uint8Array): string | null {
  if (startsWithBytes(header, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(header, JPEG_SIGNATURE)) return 'image/jpeg';
  if (header.length >= 12 && readAscii(header, 0, 4) === 'RIFF' && readAscii(header, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function isStillWebp(header: Uint8Array): boolean {
  if (header.length < 16) return false;
  if (readAscii(header, 0, 4) !== 'RIFF') return false;
  if (readAscii(header, 8, 4) !== 'WEBP') return false;

  const chunkFourCC = readAscii(header, 12, 4);
  if (chunkFourCC === 'VP8 ' || chunkFourCC === 'VP8L') return true;
  if (chunkFourCC !== 'VP8X') return false;

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


export async function downscaleImageFile(file: File, maxEdge: number): Promise<File> {
  try {
    const declaredType = normalizeMimeType(file.type);
    if (!isDownscalableImageType(declaredType)) return file;
    if (typeof globalThis.createImageBitmap !== 'function') return file;

    const header = await readHeaderBytes(file);
    if (!header) return file;
    if (sniffImageType(header) !== declaredType) return file;
    if (declaredType === 'image/webp' && !isStillWebp(header)) return file;

    const decoded = await decodeBitmap(file);
    if (!decoded) return file;
    const { bitmap, orientationApplied } = decoded;

    try {
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
      if (normalizeMimeType(blob.type) !== declaredType) return file;
      if (blob.size >= file.size) return file;

      return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
    } finally {
      closeBitmap(bitmap);
    }
  } catch {
    return file;
  }
}

async function readHeaderBytes(file: File): Promise<Uint8Array | null> {
  try {
    const header = await file.slice(0, HEADER_SNIFF_BYTES).arrayBuffer();
    return new Uint8Array(header);
  } catch {
    return null;
  }
}

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
    return null;
  }

  const bitmap = await settleWithin(decode, DECODE_TIMEOUT_MS, closeBitmap);
  if (!bitmap) return null;
  return { bitmap, orientationApplied };
}

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

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
  }
}

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
