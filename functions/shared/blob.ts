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

/** True if a stored blob path is a branding asset — the sole gate the
 * branding-asset-url endpoint uses so it can never be coerced into signing an
 * arbitrary private course-content path. Prefix + a single flat filename only
 * (no nested slashes, no traversal). */
export function isBrandingAssetPath(blobPath: string): boolean {
  return /^(org-logos|avatars)\/[A-Za-z0-9._-]+$/.test(blobPath);
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
