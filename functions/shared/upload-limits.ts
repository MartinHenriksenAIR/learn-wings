/**
 * The single source of truth for upload size caps and type allow-lists (#276).
 *
 * Uploads are browser-direct: the backend mints a short-lived SAS URL, the
 * browser PUTs straight to the private blob container, and only the resulting
 * path is posted back to be persisted. That means:
 *
 *  - The client-side caps are advisory only. Anyone can call the mint endpoint
 *    and PUT whatever they like to the URL it returns.
 *  - A SAS token CANNOT cap size. Azure's Blob Service SAS contract has no size
 *    field at all (see `sas.ts`, where the rscc/rscd/rsce/rscl/rsct fields are
 *    signed empty), so there is no signing trick that would bound the PUT.
 *
 * So enforcement happens in two places, and they do different jobs:
 *
 *  1. At mint time (`azure-upload-url`, `azure-document-upload-url`) the DECLARED
 *     filename extension and content type are checked against the allow-list.
 *     This is defence in depth and costs nothing — it does not and cannot
 *     replace (2), because the client's declaration says nothing about the bytes
 *     it will actually send.
 *  2. At persist time (`enforceUploadLimits`, called by every endpoint that
 *     writes a blob path to a column) the blob is HEADed and its REAL size and
 *     stored content type are checked. This is the gate that actually binds.
 *
 * The client mirror of these numbers lives in `src/lib/upload-limits.ts` — the
 * two trees are separate npm packages with separate tsconfigs and cannot share a
 * module, so the constants are duplicated deliberately. Change both together.
 */

import { deleteBlob, headBlob } from './blob';

/** Which cap applies. Selected by the COLUMN being written, not by anything the client says. */
export type UploadAssetKind = 'video' | 'document' | 'image';

export interface UploadLimit {
  /** Human-readable asset noun, used verbatim at the start of the 413 message. */
  label: string;
  /** Hard cap in bytes. Anything strictly larger is rejected at persist time. */
  maxBytes: number;
  /** Human-readable cap, used verbatim in the 413 message. */
  maxLabel: string;
  /**
   * Content-type prefix match (e.g. `video/`), or null when the kind uses an
   * explicit list instead. Exactly one of this and `contentTypes` is set.
   */
  contentTypePrefix: string | null;
  /** Exact content types, or null when the kind uses `contentTypePrefix`. */
  contentTypes: ReadonlySet<string> | null;
  /**
   * Lower-case, dot-less filename extensions the mint endpoints will hand out.
   *
   * Deliberately NARROWER than the content-type rule in two places:
   *  - `svg` is absent although `image/svg+xml` matches `image/`. An SVG served
   *    from a signed URL and opened directly is a scripting context; the app
   *    never offers SVG in any file picker, so allowing it would only ever widen
   *    the stored-XSS surface.
   *  - `heic`/`heif` are absent: no browser outside Safari can render them, so
   *    accepting one stores a thumbnail nobody can see.
   */
  extensions: ReadonlySet<string>;
}

/**
 * Office content types accepted for document uploads. Byte-identical to
 * `ACCEPTED_TYPES` in `src/components/ui/azure-document-upload.tsx`, which is
 * what the file picker offers.
 */
const DOCUMENT_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** The agreed caps. Mirrored (in MB) by `src/lib/upload-limits.ts`. */
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
    contentTypePrefix: 'image/',
    contentTypes: null,
    extensions: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']),
  },
};

const UPLOAD_KINDS: readonly UploadAssetKind[] = ['video', 'document', 'image'];

/**
 * Content types that carry no information about what the bytes are. Browsers
 * emit these when `File.type` is empty, and `azure-upload-url` substitutes the
 * first one when the caller declares nothing at all — so treating them as a
 * mismatch would reject legitimate uploads (notably `.mov` on some platforms).
 * They are accepted at mint time and skipped at persist time; the SIZE check,
 * which is the one that binds, is unaffected either way.
 */
const GENERIC_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

/** Strips parameters (`; charset=…`), whitespace and casing from a content type. */
export function normalizeContentType(contentType: string | null | undefined): string {
  if (typeof contentType !== 'string') return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

/** True when the content type says nothing about the payload (see GENERIC_CONTENT_TYPES). */
export function isGenericContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized === '' || GENERIC_CONTENT_TYPES.has(normalized);
}

/**
 * The lower-case extension of `fileName`, or '' when it has none or the
 * extension is not plain alphanumeric. A name without a dot is deliberately
 * extension-less rather than "the whole name": `fileName.split('.').pop()` — how
 * the mint endpoints derive the blob suffix — returns the entire filename in
 * that case, which is exactly the input this guard must not wave through.
 */
export function fileExtension(fileName: string | null | undefined): string {
  if (typeof fileName !== 'string') return '';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : '';
}

/** True when `contentType` satisfies the kind's content-type rule (prefix or exact set). */
export function matchesContentType(kind: UploadAssetKind, contentType: string | null | undefined): boolean {
  const limit = UPLOAD_LIMITS[kind];
  const normalized = normalizeContentType(contentType);
  if (!normalized) return false;
  if (limit.contentTypePrefix) return normalized.startsWith(limit.contentTypePrefix);
  return limit.contentTypes?.has(normalized) ?? false;
}

/**
 * Classifies a mint request, or returns null when it is off the allow-list.
 *
 * The extension decides the kind — it is what ends up in the blob path, and it
 * is the only field present on every request. A declared content type then has
 * to AGREE with that kind, so `logo.png` + `video/mp4` is rejected rather than
 * silently minted. A generic/absent content type is not treated as disagreement
 * (see GENERIC_CONTENT_TYPES).
 *
 * Kind is inferred rather than declared because `azure-upload-url` is shared by
 * videos, course thumbnails, documents and branding assets, and its only intent
 * field (`assetType`) distinguishes branding assets from everything else — it
 * cannot tell a video from a thumbnail.
 */
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

/** One column's worth of "this write wants to store this path, under this cap". */
export interface UploadCandidate {
  /** The path the write will persist. null/undefined/'' = nothing to check. */
  path: string | null | undefined;
  /** Which cap applies — derived from the COLUMN, never from client input. */
  kind: UploadAssetKind;
}

/** Narrows to a non-empty string; `filter(isStoredPath)` also narrows the array type. */
function isStoredPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Verdict for a single fresh path. `error` is null when the path is acceptable
 * OR when we could not conclusively establish that it is not (see the fail-open
 * note on `enforceUploadLimits`).
 */
async function inspectPath(path: string, kind: UploadAssetKind): Promise<string | null> {
  const limit = UPLOAD_LIMITS[kind];
  const head = await headBlob(path);

  // ── Fail-open branch ──────────────────────────────────────────────────────
  // Storage did not conclusively tell us this blob is over-cap or off-list, so
  // the save proceeds. Deliberate, and the trade is one-sided:
  //  · Blocking here converts any storage blip into "nobody can edit a course",
  //    and would also reject perfectly legitimate values that are not blob paths
  //    at all — `thumbnail_url` and `logo_url` have always accepted absolute
  //    external URLs, which HEAD as a 404.
  //  · It buys no security. The only way to exploit an unbounded upload is to
  //    ACTUALLY upload the bytes, and that is precisely the case a successful
  //    HEAD answers conclusively. An attacker cannot choose to be inconclusive
  //    without also failing to upload anything.
  // Every inconclusive branch is logged by `headBlob`, so a storage outage that
  // silently disabled the cap is visible in the server logs.
  if (!head.ok || !head.exists) return null;

  if (head.contentLength !== null && head.contentLength > limit.maxBytes) {
    return `${limit.label} exceeds the maximum upload size of ${limit.maxLabel}`;
  }

  // Only a POSITIVE mismatch rejects: a blob stored without a usable content
  // type is inconclusive, not off-list.
  if (!isGenericContentType(head.contentType) && !matchesContentType(kind, head.contentType)) {
    return `${limit.label} content type is not allowed`;
  }

  return null;
}

/**
 * The persist-time gate. Returns null when the write may proceed, or a
 * caller-facing message the endpoint should return as a 413.
 *
 * Only paths that are actually NEW are probed: a candidate whose path already
 * appears in `previousPaths` is skipped entirely, so
 *  - re-saving a lesson with an unchanged video costs no HEAD at all, and
 *  - an update can never be blocked because an already-stored blob has since
 *    been removed from storage by hand.
 * `previousPaths` is the same row-wide set the superseded-blob cleanup (#275)
 * diffs against, passed in whole rather than per-column, so a path that merely
 * MOVES between columns counts as already-stored in both features — one
 * comparison concept, not two that can drift.
 *
 * Rejected blobs are best-effort deleted so a refused upload does not
 * immediately become an orphan. `deleteBlob` never throws, and (like every other
 * blob-cleanup call site) its outcome is not surfaced — server logs are the only
 * failure signal.
 */
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
  const rejected = verdicts.filter((v): v is { path: string; error: string } => v.error !== null);
  if (rejected.length === 0) return null;

  await Promise.all(rejected.map((v) => deleteBlob(v.path)));
  return rejected[0].error;
}
