/**
 * Client-side mirror of the server upload caps (#276).
 *
 * The server is the authority: `functions/shared/upload-limits.ts` re-checks the
 * real byte length of every newly-referenced blob with a HEAD before the path is
 * persisted, and answers 413 if it is over. What lives here exists so the user
 * finds out BEFORE spending minutes uploading a 3 GB video, and so the numbers
 * the UI advertises cannot quietly diverge from the numbers the server enforces.
 *
 * The two trees are separate npm packages with separate tsconfigs and cannot
 * share a module, so these constants are duplicated deliberately. Change both
 * together — `functions/shared/upload-limits.ts` carries the same note.
 *
 * Note this module is NOT internationalised, matching its only consumers
 * (`file-upload.tsx`, `azure-video-upload.tsx`, `azure-document-upload.tsx`),
 * which are hard-coded English throughout.
 */

import { isDownscalableImageType, type UploadAccept } from './image-downscale';

export const BYTES_PER_MB = 1024 * 1024;

/**
 * The agreed caps, in MB. Mirrors `UPLOAD_LIMITS[kind].maxBytes` in
 * `functions/shared/upload-limits.ts`: video 2 GB, document 100 MB, image 10 MB.
 */
export const UPLOAD_MAX_MB: Readonly<Record<UploadAccept, number>> = {
  video: 2048,
  document: 100,
  image: 10,
};

/**
 * The largest file we are willing to hand to the image decoder.
 *
 * Images are downscaled before upload (#278), so the cap has to be applied to
 * the RESIZED bytes — otherwise a 20 MB phone photo destined to become a 200 KB
 * thumbnail is rejected outright, which is exactly the case the downscale
 * feature exists for. But "decode first, then measure" needs an upper bound of
 * its own, or a 500 MB file becomes a browser memory bomb before any check runs.
 * This is that bound: comfortably above any real phone photo, far below anything
 * that would wedge a tab. (It is also the old `FileUpload` default, so nothing
 * that used to be accepted for decoding stops being accepted.)
 */
export const MAX_IMAGE_DECODE_MB = 50;

/** Renders a MB figure the way a human would say it: 2048 → "2 GB", 10 → "10 MB". */
export function formatSizeMB(sizeMB: number): string {
  if (sizeMB >= 1024 && sizeMB % 1024 === 0) return `${sizeMB / 1024} GB`;
  return `${sizeMB} MB`;
}

/**
 * The cap a call site actually gets: its own `maxSizeMB` when it asked for
 * something stricter, otherwise the server cap. A call site can tighten the
 * limit (avatars ask for 2 MB) but can never advertise a limit the server would
 * refuse, so the UI and the 413 can't contradict each other.
 */
export function effectiveMaxSizeMB(accept: UploadAccept, requestedMB?: number): number {
  const cap = UPLOAD_MAX_MB[accept];
  if (typeof requestedMB !== 'number' || !Number.isFinite(requestedMB) || requestedMB <= 0) return cap;
  return Math.min(requestedMB, cap);
}

/**
 * True when this file will go through the downscaler, so the cap must be applied
 * to the re-encoded output rather than to what the user picked.
 *
 * Both halves matter: `accept` decides whether the call site downscales at all,
 * and the MIME type decides whether this particular file can be re-encoded
 * without losing something (animated GIFs and SVGs are uploaded untouched).
 */
export function willDownscale(accept: UploadAccept, mimeType: string | null | undefined): boolean {
  return accept === 'image' && isDownscalableImageType(mimeType);
}

/**
 * Gate for the file the user just picked, applied BEFORE any decoding.
 * Returns null when the file may proceed, or the message to show.
 *
 * For a file that will be downscaled the limit here is the decode ceiling, NOT
 * the upload cap — the whole point is that an oversized photo gets shrunk rather
 * than refused. The cap is then applied to the resized bytes by
 * `checkUploadPayloadSize`. For everything else the two checks coincide.
 */
export function checkSelectedFileSize(
  bytes: number,
  capMB: number,
  downscalable: boolean,
): string | null {
  if (!downscalable) return checkUploadPayloadSize(bytes, capMB);

  const ceilingMB = Math.max(capMB, MAX_IMAGE_DECODE_MB);
  if (bytes > ceilingMB * BYTES_PER_MB) {
    return `Image is too large to process. Choose a file under ${formatSizeMB(ceilingMB)}.`;
  }
  return null;
}

/**
 * Gate for the bytes that will ACTUALLY be uploaded — the downscaled image when
 * one was produced, the original file otherwise. This is the check that mirrors
 * the server's, so passing it is what makes the subsequent save succeed.
 */
export function checkUploadPayloadSize(bytes: number, capMB: number): string | null {
  if (bytes > capMB * BYTES_PER_MB) {
    return `File size must be less than ${formatSizeMB(capMB)}`;
  }
  return null;
}
