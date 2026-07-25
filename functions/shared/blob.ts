import { generateSasToken, buildBlobUrl } from './sas';

/**
 * Client-uploadable branding asset types → their folder prefix within the
 * private default container. Branding assets (org logos, avatars) live in the
 * SAME private container as course content and are served via short-lived
 * signed URLs (see the branding-asset-url endpoint) — NOT anonymous public
 * access (the storage account has `allowBlobPublicAccess=false`).
 */
export const BRANDING_ASSET_PREFIXES: Record<string, string> = {
  'org-logo': 'org-logos/',
  'avatar': 'avatars/',
};

/** True if `assetType` is a client-uploadable branding asset (org logo / avatar). */
export function isBrandingAssetType(assetType?: string): boolean {
  return !!assetType && assetType in BRANDING_ASSET_PREFIXES;
}

/**
 * Which NAMESPACE of blob paths a database column is allowed to bind.
 *
 * Every path this system mints has one of exactly three shapes, and the shape is
 * decided by the endpoint that minted it — never by the client:
 *  - `'avatar'`   — `avatars/<name>`    (azure-upload-url, assetType=avatar)
 *  - `'org-logo'` — `org-logos/<name>`  (azure-upload-url, assetType=org-logo)
 *  - `'lms'`      — course thumbnails, lesson videos and lesson documents. This
 *    is the CATCH-ALL: `resolveAssetContainer` gives a non-branding upload an
 *    EMPTY prefix, so a thumbnail and a video are `<uuid>.<ext>` alike, and the
 *    same columns also still hold Supabase-era names with folders in them
 *    (`thumbnails/x.png`, `videos/x.mp4`). There is no shape that separates
 *    those three uses, and inventing one would only lock existing rows out of
 *    being saved. What separates them is the extension allow-list
 *    (`upload-limits.ts`) and the cross-row reference check
 *    (`blob-ownership.ts`); the family is not asked to do a job it cannot do.
 */
export type BlobPathFamily = 'avatar' | 'org-logo' | 'lms';

/**
 * One path segment, as this system mints them: a leading alphanumeric then
 * `[A-Za-z0-9._-]`. The character class is byte-identical to `SAFE_BLOB_NAME` in
 * orphan-sweep.
 *
 * The leading-alphanumeric requirement is what excludes `.` and `..` — under a
 * bare `[A-Za-z0-9._-]+` the segment `..` matches, and `avatars/..` would have
 * been accepted as a branding path.
 */
const BLOB_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*';

/**
 * The two branding families, and only those, have a shape: a fixed folder
 * prefix plus ONE flat segment, exactly as `azure-upload-url` mints them.
 * `'lms'` deliberately has no entry — see `classifyBlobPath`.
 */
const BRANDING_FAMILY_PATTERNS: Readonly<Record<'avatar' | 'org-logo', RegExp>> = {
  'avatar': new RegExp(`^avatars/${BLOB_SEGMENT}$`),
  'org-logo': new RegExp(`^org-logos/${BLOB_SEGMENT}$`),
};

/**
 * An absolute http(s) URL. `thumbnail_url` has always been allowed to hold one
 * and the read path resolves it (`extractLmsAssetPath` in `src/lib/storage.ts`);
 * `logo_url` and `avatar_url` have historically accepted one too, though
 * `branding-asset-url` will not sign it, so such a value simply renders nothing.
 * Either way it must not be rejected on write, and it is the one and only
 * "not a blob we own" value allowed through.
 */
const ABSOLUTE_URL = /^https?:\/\//i;

/**
 * What a client-supplied column value IS, relative to the family the column may bind.
 *
 *  - `'own'`      — a value this column may legitimately hold. Subject to the
 *    extension allow-list and the cross-row reference check, and the ONLY
 *    verdict that permits a storage probe or a delete.
 *  - `'external'` — an absolute http(s) URL. Allowed and stored verbatim, never
 *    reference-checked (two courses may legitimately point at the same public
 *    image) and never deletable — `isBlobReleasable` refuses it outright. See
 *    `buildBlobUrl` for why it could not address a real blob even if something
 *    tried: the whole URL becomes ONE escaped blob name, and no blob is named
 *    `https://…`.
 *  - `'foreign'`  — refused at bind time: a branding path posted to a column
 *    that does not own that prefix, a malformed value under a prefix we mint
 *    (`avatars/..`, `avatars/sub/deep.png`), or a non-branding path posted to a
 *    branding column.
 *
 * NOTE WHAT IS *NOT* HERE. There is no "unrecognized, so store it and hope
 * nothing acts on it" bucket, and equally no attempt to pin the LMS columns to a
 * minted shape. Both were tried and both were wrong:
 *  - waving unrecognized values through skipped the reference check, so a legacy
 *    name like `videos/<uuid>.mp4` — which `deleteBlob` resolves perfectly well —
 *    could be bound to a second row and then destroyed by a cascade delete;
 *  - refusing them instead bricked real rows: `CourseEditor` re-persists
 *    `extractLmsAssetPath(<signed url>)`, which for a legacy thumbnail yields
 *    `thumbnails/x.png`, and a 400 there blocks saving the course's title and
 *    description too.
 * So the LMS columns take everything that is not branding and not a URL, and the
 * cross-row reference check — not the spelling — decides whether it may be bound.
 */
export type BlobPathVerdict = 'own' | 'external' | 'foreign';

/** Classifies a stored/incoming column value against the family that column may bind. */
export function classifyBlobPath(value: string, family: BlobPathFamily): BlobPathVerdict {
  if (value === '') return 'foreign';
  if (ABSOLUTE_URL.test(value)) return 'external';

  // A branding prefix is owned by exactly one family, so a value carrying one is
  // decided entirely here — including a malformed one, which is a refusal rather
  // than a legacy value (nothing predates a prefix this system invented).
  for (const brandingFamily of ['avatar', 'org-logo'] as const) {
    if (!value.startsWith(BRANDING_ASSET_PREFIXES[brandingFamily])) continue;
    return family === brandingFamily && BRANDING_FAMILY_PATTERNS[brandingFamily].test(value)
      ? 'own'
      : 'foreign';
  }

  // Not branding, not a URL — the flat LMS namespace and its legacy leftovers.
  // A branding column must not accept one of these: `avatar_url` holding a bare
  // `<uuid>.mp4` is how a lesson video got aimed at an image cap.
  return family === 'lms' ? 'own' : 'foreign';
}

/** True if a stored blob path is a branding asset — the sole gate the
 * branding-asset-url endpoint uses so it can never be coerced into signing an
 * arbitrary private course-content path. Prefix + a single flat filename only
 * (no nested slashes, no traversal). */
export function isBrandingAssetPath(blobPath: string): boolean {
  return classifyBlobPath(blobPath, 'avatar') === 'own'
    || classifyBlobPath(blobPath, 'org-logo') === 'own';
}

/**
 * Resolves a client-declared upload `assetType` to a container + folder prefix.
 *
 * The client only ever declares intent (`assetType`); this hardcoded allow-list is the
 * sole place that maps intent to a prefix, so the client can never target an
 * arbitrary path. Everything uploads to the private default container; branding
 * assets just get a folder prefix. An absent or unrecognized `assetType` gets no
 * prefix — intentionally not an error (the enum is an allow-list, not validated input).
 */
export function resolveAssetContainer(assetType?: string): { container: string; prefix: string } {
  return {
    container: process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos',
    prefix: (assetType && BRANDING_ASSET_PREFIXES[assetType]) ?? '',
  };
}

/**
 * Deletes a blob from Azure Blob Storage using a short-lived SAS token.
 *
 * Returns true  if the delete succeeded (2xx) or the blob was already gone (404).
 * Returns false for any other non-ok status, or if a network error occurs.
 * Never throws.
 */
export async function deleteBlob(blobPath: string): Promise<boolean> {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  if (!accountName || !accountKey) {
    console.warn('[deleteBlob] Missing storage env vars — skipping blob delete for', blobPath);
    return false;
  }

  try {
    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'd', 10);
    const deleteUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);
    const res = await fetch(deleteUrl, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      return true;
    }
    console.warn(`[deleteBlob] Storage returned ${res.status} for`, blobPath);
    return false;
  } catch (err: unknown) {
    console.warn('[deleteBlob] fetch failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * What a HEAD against a blob told us.
 *
 * `ok` is the conclusiveness flag and MUST be checked first: it is true only
 * when storage actually answered about this blob (2xx or 404). Every failure —
 * missing env vars, a network error, an unexpected status — comes back as
 * `ok: false`, which callers are expected to treat as "we do not know" rather
 * than as "the blob is fine" or "the blob is absent".
 */
export interface BlobHead {
  /** True only when storage answered conclusively (2xx or 404). */
  ok: boolean;
  /** True only when the blob exists (a 2xx HEAD). False for 404 AND for every inconclusive answer. */
  exists: boolean;
  /** Parsed Content-Length in bytes, or null when absent/unparseable/inconclusive. */
  contentLength: number | null;
  /** Content-Type as stored on the blob, or null when absent/inconclusive. */
  contentType: string | null;
}

/** The single "we could not find out" value — never conflated with "blob absent". */
const INCONCLUSIVE_HEAD: BlobHead = { ok: false, exists: false, contentLength: null, contentType: null };

/**
 * Reads a response header without assuming a spec-complete `Headers` object —
 * mocked fetch responses in tests routinely omit it entirely.
 */
function readHeader(res: Response, name: string): string | null {
  try {
    return res.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Probes a blob's size and content type with a short-lived read SAS + HTTP HEAD.
 *
 * Structural twin of `deleteBlob`: env is read lazily (never at module load),
 * the SAS is minted per call, and it NEVER throws — every failure path returns
 * `INCONCLUSIVE_HEAD` so a caller can decide what an unknown answer means.
 *
 * A HEAD is the only way to learn an uploaded blob's size: a Blob SAS cannot
 * cap it (Azure has no size field in the SAS contract, and `sas.ts` signs the
 * rscc/rscd/rsce/rscl/rsct fields empty), so size enforcement can only happen
 * after the bytes have landed.
 */
export async function headBlob(blobPath: string): Promise<BlobHead> {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos';

  if (!accountName || !accountKey) {
    console.warn('[headBlob] Missing storage env vars — skipping blob probe for', blobPath);
    return INCONCLUSIVE_HEAD;
  }

  try {
    const sasToken = generateSasToken(accountName, accountKey, containerName, blobPath, 'r', 10);
    const headUrl = buildBlobUrl(accountName, containerName, blobPath, sasToken);
    const res = await fetch(headUrl, { method: 'HEAD' });

    // 404 is a conclusive answer: storage is reachable and the blob is not there.
    if (res.status === 404) return { ok: true, exists: false, contentLength: null, contentType: null };

    if (!res.ok) {
      console.warn(`[headBlob] Storage returned ${res.status} for`, blobPath);
      return INCONCLUSIVE_HEAD;
    }

    const rawLength = readHeader(res, 'content-length');
    const parsedLength = rawLength === null || rawLength.trim() === '' ? Number.NaN : Number(rawLength);
    return {
      ok: true,
      exists: true,
      contentLength: Number.isFinite(parsedLength) && parsedLength >= 0 ? parsedLength : null,
      contentType: readHeader(res, 'content-type'),
    };
  } catch (err: unknown) {
    console.warn('[headBlob] fetch failed:', err instanceof Error ? err.message : err);
    return INCONCLUSIVE_HEAD;
  }
}

/**
 * Best-effort bulk blob cleanup for cascade-delete endpoints.
 *
 * `deleteBlob` never throws, so this never rejects either: every path is attempted,
 * failures are counted rather than propagated. A single warning tagged with `logTag`
 * and `id` is emitted server-side when any path failed — server logs are the only
 * signal for failed cleanup — and the counts are returned for the client response.
 */
export async function cleanupBlobs(
  paths: string[],
  logTag: string,
  id: string,
): Promise<{ blobsDeleted: number; blobsFailed: number }> {
  const results = await Promise.all(paths.map((p) => deleteBlob(p)));
  const blobsDeleted = results.filter(Boolean).length;
  const blobsFailed = results.length - blobsDeleted;
  if (blobsFailed > 0) {
    console.warn(`[${logTag}] ${blobsFailed} blob(s) failed to delete for`, id);
  }
  return { blobsDeleted, blobsFailed };
}
