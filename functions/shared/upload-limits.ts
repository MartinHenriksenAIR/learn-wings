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
 *     writes a blob path to a column) the blob is HEADed and its REAL size,
 *     stored content type and path extension are checked.
 *
 * WHAT (2) IS AND IS NOT. It is the only place the real bytes are ever measured,
 * and it is what stops an over-cap blob from being REFERENCED by a row. It is
 * NOT an unconditional bound on what can sit in the container, and this file
 * previously claimed otherwise. A deliberate attacker controls the ORDER of the
 * two client steps, and the SAS stays valid for 30 minutes:
 *     mint SAS → save the row while the blob is still absent (a conclusive 404
 *     is a fail-open answer, see `inspectPath`) → THEN PUT the oversized bytes.
 * Nothing re-probes afterwards, and re-probing on every save would not close it
 * either — the attacker simply never saves again. What actually bounds container
 * growth for an unreferenced blob is the nightly `orphan-sweep`; a blob that IS
 * referenced by a row is bounded by nothing here. Closing that properly needs
 * enforcement at serve time or a size reconciliation pass, neither of which
 * exists yet.
 *
 * WHAT THIS MODULE DOES NOT DO AT ALL: decide whether the caller is allowed to
 * bind this path to this row. A path is just a client-supplied string, and until
 * #275 that string was inert. `blob-ownership.ts` is the gate for that question
 * and MUST run first — every caller of `enforceUploadLimits` calls
 * `assertBindablePaths` on the same candidate array immediately before it, so
 * that no foreign path is ever handed to `headBlob`. What does still reach
 * `headBlob` here is an `'external'` value (an absolute URL, always legal in
 * `thumbnail_url` / `logo_url` / `avatar_url`); it is HEADed, answers 404 or 403,
 * and takes the fail-open branch. One wasted round trip, no verdict.
 *
 * The client mirror of these numbers lives in `src/lib/upload-limits.ts` — the
 * two trees are separate npm packages with separate tsconfigs and cannot share a
 * module, so the constants are duplicated deliberately. Change both together.
 */

import { headBlob, type BlobPathFamily } from './blob';

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
   *
   * A prefix is only safe for a kind where EVERY member of the type tree is
   * acceptable. That is true of `video/` and is emphatically NOT true of
   * `image/` — see `IMAGE_CONTENT_TYPES`.
   */
  contentTypePrefix: string | null;
  /** Exact content types, or null when the kind uses `contentTypePrefix`. */
  contentTypes: ReadonlySet<string> | null;
  /**
   * Lower-case, dot-less filename extensions this kind may be stored under.
   * Checked against the DECLARED filename at mint time AND against the STORED
   * path at persist time (`inspectPath`), because the declared filename is
   * discarded once the path is minted.
   *
   * Deliberately narrow:
   *  - `svg` is absent. An SVG served from a signed URL and opened directly is a
   *    scripting context; the app never offers SVG in any file picker, so
   *    allowing it would only ever widen the stored-XSS surface.
   *  - `heic`/`heif` are absent: no browser outside Safari can render them, so
   *    accepting one stores a thumbnail nobody can see.
   */
  extensions: ReadonlySet<string>;
}

/**
 * Office content types accepted for document uploads. Byte-identical to
 * `UPLOAD_TYPE_RULES.document.contentTypes` in `src/lib/upload-limits.ts`, which
 * is what the file picker offers.
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

/**
 * Image content types accepted for image uploads — an EXPLICIT list, not an
 * `image/` prefix match.
 *
 * A prefix match here was a hole, not a shortcut. `image/svg+xml` starts with
 * `image/`, so an SVG passed the persist-time check even though `svg` is off the
 * extension allow-list: mint `avatars/<uuid>.png` declaring `image/png`, then PUT
 * SVG bytes with `x-ms-blob-content-type: image/svg+xml`. The declared filename
 * is discarded at mint time, so nothing downstream ever saw the disagreement.
 * The same hole admitted `image/heic`, `image/bmp` and `image/tiff`.
 *
 * The list is byte-identical to `UPLOAD_TYPE_RULES.image.contentTypes` in
 * `src/lib/upload-limits.ts`, which is what the file pickers offer (every
 * `<input type="file">` in the app derives its `accept` attribute from that
 * table). `image/jpg` is on both: a non-standard alias some platforms still
 * report for `.jpg`, it maps onto an allow-listed extension, and rejecting it
 * would break a legitimate upload for no security gain.
 */
const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
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
    contentTypePrefix: null,
    contentTypes: IMAGE_CONTENT_TYPES,
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
  /**
   * Which blob-path namespace this COLUMN may bind — also derived from the
   * column, never from client input. Consumed by `assertBindablePaths`
   * (`blob-ownership.ts`); carried on the same object so an endpoint builds ONE
   * candidate array and hands the identical list to both gates, and the two can
   * never be given different views of the same write.
   */
  family: BlobPathFamily;
}

/**
 * True when the stored path's extension is one this KIND may be stored under.
 *
 * The mint endpoints check the caller's DECLARED filename and then throw it
 * away, so this is the only check that sees what the persisted path actually
 * ends in. Called from two places with deliberately different preconditions:
 *  - `assertBindablePaths`, for a path already classified as belonging to this
 *    column's family — a pure check, before any storage round trip. This is what
 *    keeps the flat `lms` namespace honest: a `<uuid>.mp4` cannot be bound to
 *    `thumbnail_url`, whose kind is `image`.
 *  - `inspectPath`, but only AFTER a conclusive "the blob exists" HEAD, so that
 *    an absolute external URL (always allowed in `thumbnail_url` / `logo_url`,
 *    and extension-less as often as not) is never judged by it.
 */
export function pathExtensionAllowed(path: string, kind: UploadAssetKind): boolean {
  return UPLOAD_LIMITS[kind].extensions.has(fileExtension(path));
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
  // Storage did not tell us this blob is over-cap or off-list — either because it
  // could not answer, or because the blob is not there — so the save proceeds.
  // Deliberate, but NOT free, and the old claim here that it "buys no security"
  // was wrong. Both halves, honestly:
  //  · `!head.ok` (a blip, an outage, missing env). Blocking would convert any
  //    storage wobble into "nobody can edit a course". `headBlob` logs every one
  //    of these, so a silently disabled cap is visible server-side.
  //  · `!head.exists` (a conclusive 404). This is what keeps legitimate non-blob
  //    values working — `thumbnail_url` and `logo_url` have always accepted
  //    absolute external URLs, which HEAD as a 404 — and it is ALSO the hole an
  //    attacker walks through: save the row while the blob is still absent, then
  //    PUT the oversized bytes with the SAS that is valid for another 30 minutes.
  //    Rejecting a 404 instead would break every external URL and still not close
  //    it (a second PUT after a small first upload does the same job). See the
  //    module docblock: nothing here bounds a blob that a row already references.
  if (!head.ok || !head.exists) return null;

  // Past this point the blob demonstrably EXISTS in our container, so it is a
  // path we minted and its extension is ours to insist on. Checked here rather
  // than before the HEAD so that an absolute external URL — legitimate in
  // `thumbnail_url` / `logo_url`, and frequently extension-less — reaches the
  // 404 fail-open above instead of being rejected for its spelling.
  if (!pathExtensionAllowed(path, kind)) {
    return `${limit.label} content type is not allowed`;
  }

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
 * The skip is a considered choice, not just a round-trip saving. Re-probing every
 * path on every save was the obvious answer to the persist-then-upload ordering
 * hole, and it does not actually close it: the attacker decides when to save, and
 * simply never saves again. What it WOULD reliably do is make any row whose blob
 * predates these caps permanently unsavable — a legacy 3 GB video would 413 every
 * edit of the lesson that references it, with no way out except clearing the
 * column. Paying that to catch an attacker who has to volunteer for it is a bad
 * trade; the real fix belongs at serve time or in a reconciliation pass.
 *
 * A REFUSED BLOB IS NOT DELETED HERE, deliberately. It used to be, as a courtesy
 * so a refused upload did not become an orphan — and that one line was a
 * one-request arbitrary-blob-delete primitive: `previousPaths` is row-scoped, so
 * a path belonging to a DIFFERENT row was "fresh", got probed, failed this
 * column's cap, and was destroyed while the row that actually referenced it was
 * untouched. `blob-ownership.ts` now refuses a foreign path before it ever gets
 * here, but the courtesy is not worth re-introducing on top of that: it bought
 * roughly 24 hours of storage (`orphan-sweep` reclaims unreferenced blobs after
 * its grace window anyway) and cost a deletion path reachable from a request
 * that never writes a row.
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
  return verdicts.find((v) => v.error !== null)?.error ?? null;
}
