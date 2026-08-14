import {
  isDownscalableImageType,
  normalizeMimeType,
  type UploadAccept,
} from './image-downscale';

export const BYTES_PER_MB = 1024 * 1024;

export interface UploadMessage {
  key: string;
  values?: Record<string, string>;
}

export const UPLOAD_MAX_MB: Readonly<Record<UploadAccept, number>> = {
  video: 2048,
  document: 100,
  image: 10,
};

export const MAX_IMAGE_DECODE_MB = 20;

interface UploadTypeRule {
  extensions: readonly string[];
  contentTypes: readonly string[];
  contentTypePrefix: string | null;
}

const UPLOAD_TYPE_RULES: Readonly<Record<UploadAccept, UploadTypeRule>> = {
  image: {
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
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

export const UPLOAD_ACCEPT_ATTRIBUTE: Readonly<Record<UploadAccept, string>> = {
  image: buildAcceptAttribute('image'),
  video: buildAcceptAttribute('video'),
  document: buildAcceptAttribute('document'),
};

function buildAcceptAttribute(accept: UploadAccept): string {
  const rule = UPLOAD_TYPE_RULES[accept];
  return [...rule.contentTypes, ...rule.extensions.map((ext) => `.${ext}`)].join(',');
}

const TYPE_ERROR_KEYS: Readonly<Record<UploadAccept, string>> = {
  image: 'fileUpload.errorTypeImage',
  video: 'fileUpload.errorTypeVideo',
  document: 'fileUpload.errorTypeDocument',
};

const GENERIC_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

export function fileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== 'string') return '';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : '';
}

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

export function checkUploadFileType(
  accept: UploadAccept,
  file: { name: string; type?: string | null },
): UploadMessage | null {
  if (isAllowedUploadFile(accept, file)) return null;
  return { key: TYPE_ERROR_KEYS[accept] };
}

export function formatSizeMB(sizeMB: number): string {
  if (sizeMB >= 1024 && sizeMB % 1024 === 0) return `${sizeMB / 1024} GB`;
  return `${sizeMB} MB`;
}

export function effectiveMaxSizeMB(accept: UploadAccept, requestedMB?: number): number {
  const cap = UPLOAD_MAX_MB[accept];
  if (typeof requestedMB !== 'number' || !Number.isFinite(requestedMB) || requestedMB <= 0) return cap;
  return Math.min(requestedMB, cap);
}

export function willDownscale(accept: UploadAccept, mimeType: string | null | undefined): boolean {
  return accept === 'image' && isDownscalableImageType(mimeType);
}

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

export function checkUploadPayloadSize(bytes: number, capMB: number): UploadMessage | null {
  if (bytes > capMB * BYTES_PER_MB) {
    return { key: 'fileUpload.errorTooLarge', values: { size: formatSizeMB(capMB) } };
  }
  return null;
}
