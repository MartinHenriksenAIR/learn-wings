/**
 * Client-side mirror of the server upload rules (#276).
 *
 * The server is the authority: `functions/shared/upload-limits.ts` checks the
 * declared extension and content type when it mints a SAS URL, and re-checks the
 * real byte length and stored content type of every newly-referenced blob with a
 * HEAD before the path is persisted. What lives here exists so the user finds
 * out BEFORE spending minutes uploading a 3 GB video, so the pickers only offer
 * what the server will accept, and so the numbers and formats the UI advertises
 * cannot quietly diverge from the ones the server enforces.
 *
 * The two trees are separate npm packages with separate tsconfigs and cannot
 * share a module, so these values are duplicated deliberately. Change both
 * together — `functions/shared/upload-limits.ts` carries the same note.
 *
 * User-facing text is returned as an `UploadMessage` (i18n key + interpolation
 * values) rather than an English sentence: this module has no React context to
 * translate with, and its consumers render in both en and da.
 */

import {
  isDownscalableImageType,
  normalizeMimeType,
  type UploadAccept,
} from './image-downscale';

export const BYTES_PER_MB = 1024 * 1024;

/**
 * A message for the user, resolved by whichever component renders it.
 * `key` is always under the `fileUpload.*` i18n namespace.
 */
export interface UploadMessage {
  key: string;
  values?: Record<string, string>;
}

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
 * the RESIZED bytes — otherwise a 15 MB phone photo destined to become a 200 KB
 * thumbnail is rejected outright, which is exactly the case the downscale
 * feature exists for. But "decode first, then measure" needs an upper bound of
 * its own, or a large file becomes a browser memory bomb before any check runs.
 *
 * This bound is deliberately tight. It cannot be sized against the real hazard —
 * a decoded `ImageBitmap` costs 4 bytes per PIXEL, and a well-compressed PNG of
 * flat-colour art reaches 100:1, so even a modest file can ask for hundreds of
 * MB of RGBA. Chrome refuses the allocation (which fails open, harmlessly);
 * Safari/iOS tends to kill the tab, which no `try`/`catch` can recover. A
 * post-decode pixel guard buys nothing — the allocation has already happened.
 * So the only lever is to keep the byte ceiling as low as real content allows:
 * a phone photo is 3–12 MB even at 108 MP, and everything above 20 MB is either
 * a scan, a render, or a mistake — all better refused with a clear message than
 * decoded on the main thread.
 */
export const MAX_IMAGE_DECODE_MB = 20;

/** The file types one picker offers and the rule the server applies to them. */
interface UploadTypeRule {
  /**
   * Lower-case, dot-less extensions, mirroring `UPLOAD_LIMITS[kind].extensions`.
   * These are what the mint endpoint actually keys on, so they are what the
   * picker offers.
   */
  extensions: readonly string[];
  /** Exact content types offered in the picker alongside the extensions. */
  contentTypes: readonly string[];
  /**
   * The server's content-type rule: a prefix match, or null when the kind uses
   * `contentTypes` as an exact set. Validation follows the SERVER's (wider)
   * rule, so the client can never refuse something the server would accept.
   */
  contentTypePrefix: string | null;
}

/**
 * Mirror of the server allow-lists in `functions/shared/upload-limits.ts` —
 * that module is the source of truth; change it and this together.
 *
 * Note what is deliberately absent, and why (the server's own notes carry the
 * long form): `svg` — an SVG served from a signed URL is a scripting context;
 * `heic`/`heif` — nothing outside Safari can render them.
 */
const UPLOAD_TYPE_RULES: Readonly<Record<UploadAccept, UploadTypeRule>> = {
  image: {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    // An explicit list, not an `image/` prefix: the server made the same change
    // because a prefix admitted `image/svg+xml`, `image/heic`, `image/bmp` and
    // `image/tiff`. `image/jpg` is the non-standard alias some platforms still
    // report for `.jpg`, and the server accepts it.
    contentTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
    contentTypePrefix: null,
  },
  video: {
    extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
    contentTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg'],
    contentTypePrefix: 'video/',
  },
  document: {
    extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
    contentTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    contentTypePrefix: null,
  },
};

/**
 * The `accept` attribute for each picker. Content types and extensions both:
 * the extension list is what the server keys on, and some platforms report no
 * usable content type for `.mov`/`.m4v` at all.
 *
 * Every `<input type="file">` in the app derives its `accept` from here, so no
 * picker can offer a format the server would refuse with a bare
 * "File type not allowed".
 */
export const UPLOAD_ACCEPT_ATTRIBUTE: Readonly<Record<UploadAccept, string>> = {
  image: buildAcceptAttribute('image'),
  video: buildAcceptAttribute('video'),
  document: buildAcceptAttribute('document'),
};

function buildAcceptAttribute(accept: UploadAccept): string {
  const rule = UPLOAD_TYPE_RULES[accept];
  return [...rule.contentTypes, ...rule.extensions.map((ext) => `.${ext}`)].join(',');
}

/** Message naming the formats each picker accepts, when one is refused. */
const TYPE_ERROR_KEYS: Readonly<Record<UploadAccept, string>> = {
  image: 'fileUpload.errorTypeImage',
  video: 'fileUpload.errorTypeVideo',
  document: 'fileUpload.errorTypeDocument',
};

/**
 * Content types that say nothing about the payload. The server treats these as
 * inconclusive rather than as a mismatch (browsers emit them when `File.type`
 * is empty, notably for `.mov` on some platforms), so we must too — being
 * stricter here would refuse uploads the server would have accepted.
 */
const GENERIC_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

/**
 * The lower-case extension of `fileName`, or '' when it has none or the
 * extension is not plain alphanumeric. Mirrors the server's `fileExtension`,
 * including its refusal to treat a dot-less name as one big extension.
 */
export function fileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== 'string') return '';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : '';
}

/**
 * True when the server's mint endpoint would classify this file as `accept`.
 *
 * Mirrors `resolveUploadKind`: the extension decides the kind, and a declared
 * content type then has to agree with it. A generic or absent content type is
 * not disagreement.
 */
export function isAllowedUploadFile(
  accept: UploadAccept,
  file: { name: string; type?: string | null },
): boolean {
  const rule = UPLOAD_TYPE_RULES[accept];
  if (!rule.extensions.includes(fileExtension(file.name))) return false;

  const contentType = normalizeMimeType(file.type);
  if (!contentType || GENERIC_CONTENT_TYPES.has(contentType)) return true;
  if (rule.contentTypePrefix) return contentType.startsWith(rule.contentTypePrefix);
  return rule.contentTypes.includes(contentType);
}

/**
 * Gate for the type of the file the user picked. Returns null when it may
 * proceed, or a message naming the formats this picker accepts — the server's
 * own refusal is a bare "File type not allowed" with no such hint.
 */
export function checkUploadFileType(
  accept: UploadAccept,
  file: { name: string; type?: string | null },
): UploadMessage | null {
  if (isAllowedUploadFile(accept, file)) return null;
  return { key: TYPE_ERROR_KEYS[accept] };
}

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
 *
 * The ceiling is never allowed below the cap it guards, so a call site with a
 * cap above `MAX_IMAGE_DECODE_MB` doesn't get a gate that is stricter than the
 * limit it advertises.
 */
export function checkSelectedFileSize(
  bytes: number,
  capMB: number,
  downscalable: boolean,
): UploadMessage | null {
  if (!downscalable) return checkUploadPayloadSize(bytes, capMB);

  const ceilingMB = Math.max(capMB, MAX_IMAGE_DECODE_MB);
  if (bytes > ceilingMB * BYTES_PER_MB) {
    return { key: 'fileUpload.errorTooLargeToDecode', values: { size: formatSizeMB(ceilingMB) } };
  }
  return null;
}

/**
 * Gate for the bytes that will ACTUALLY be uploaded — the downscaled image when
 * one was produced, the original file otherwise. This is the check that mirrors
 * the server's, so passing it is what makes the subsequent save succeed.
 */
export function checkUploadPayloadSize(bytes: number, capMB: number): UploadMessage | null {
  if (bytes > capMB * BYTES_PER_MB) {
    return { key: 'fileUpload.errorTooLarge', values: { size: formatSizeMB(capMB) } };
  }
  return null;
}
