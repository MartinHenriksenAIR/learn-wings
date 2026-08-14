import { headBlob, type BlobPathFamily } from './blob';

export type UploadAssetKind = 'video' | 'document' | 'image';

export interface UploadLimit {
  label: string;
  maxBytes: number;
  maxLabel: string;
  contentTypePrefix: string | null;
  contentTypes: ReadonlySet<string> | null;
  extensions: ReadonlySet<string>;
}

const DOCUMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

export const UPLOAD_LIMITS: Readonly<Record<UploadAssetKind, UploadLimit>> = {
  video: {
    label: 'Video',
    maxBytes: 2 * 1024 * 1024 * 1024,
    maxLabel: '2 GB',
    contentTypePrefix: 'video/',
    contentTypes: null,
    extensions: new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']),
  },
  document: {
    label: 'Document',
    maxBytes: 100 * 1024 * 1024,
    maxLabel: '100 MB',
    contentTypePrefix: null,
    contentTypes: DOCUMENT_CONTENT_TYPES,
    extensions: new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']),
  },
  image: {
    label: 'Image',
    maxBytes: 10 * 1024 * 1024,
    maxLabel: '10 MB',
    contentTypePrefix: null,
    contentTypes: IMAGE_CONTENT_TYPES,
    extensions: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']),
  },
};

const UPLOAD_KINDS: readonly UploadAssetKind[] = ['video', 'document', 'image'];

const GENERIC_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

export function normalizeContentType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

export function isGenericContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized === '' || GENERIC_CONTENT_TYPES.has(normalized);
}

export function fileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== 'string') return '';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : '';
}

export function matchesContentType(kind: UploadAssetKind, contentType: string | null | undefined): boolean {
  const limit = UPLOAD_LIMITS[kind];
  const normalized = normalizeContentType(contentType);
  if (!normalized) return false;
  if (limit.contentTypePrefix) return normalized.startsWith(limit.contentTypePrefix);
  return limit.contentTypes?.has(normalized) ?? false;
}

export function resolveUploadKind(
  fileName: string | null | undefined,
  contentType?: string | null,
): UploadAssetKind | null {
  const ext = fileExtension(fileName);
  if (!ext) return null;
  const kind = UPLOAD_KINDS.find((k) => UPLOAD_LIMITS[k].extensions.has(ext));
  if (!kind) return null;
  if (!isGenericContentType(contentType) && !matchesContentType(kind, contentType)) return null;
  return kind;
}

export interface UploadCandidate {
  path: string | null | undefined;
  kind: UploadAssetKind;
  family: BlobPathFamily;
}

export function pathExtensionAllowed(path: string, kind: UploadAssetKind): boolean {
  return UPLOAD_LIMITS[kind].extensions.has(fileExtension(path));
}

function isStoredPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

async function inspectPath(path: string, kind: UploadAssetKind): Promise<string | null> {
  const limit = UPLOAD_LIMITS[kind];
  const head = await headBlob(path);

  if (!head.ok || !head.exists) return null;

  if (!pathExtensionAllowed(path, kind)) {
    return `${limit.label} content type is not allowed`;
  }

  if (head.contentLength !== null && head.contentLength > limit.maxBytes) {
    return `${limit.label} exceeds the maximum upload size of ${limit.maxLabel}`;
  }

  if (!isGenericContentType(head.contentType) && !matchesContentType(kind, head.contentType)) {
    return `${limit.label} content type is not allowed`;
  }

  return null;
}

export async function enforceUploadLimits(
  candidates: readonly UploadCandidate[],
  previousPaths: readonly (string | null | undefined)[] = [],
): Promise<string | null> {
  const alreadyStored = new Set(previousPaths.filter(isStoredPath));

  const fresh: { path: string; kind: UploadAssetKind }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const { path } = candidate;
    if (!isStoredPath(path)) continue;
    if (alreadyStored.has(path)) continue;
    if (seen.has(path)) continue;   // same path in two columns → one HEAD
    seen.add(path);
    fresh.push({ path, kind: candidate.kind });
  }

  if (fresh.length === 0) return null;

  const verdicts = await Promise.all(
    fresh.map(async ({ path, kind }) => ({ path, error: await inspectPath(path, kind) })),
  );
  return verdicts.find((v) => v.error !== null)?.error ?? null;
}
