import { generateSasToken, buildBlobUrl } from './sas';

export const BRANDING_ASSET_PREFIXES: Record<string, string> = {
  'org-logo': 'org-logos/',
  'avatar': 'avatars/',
};

export function isBrandingAssetType(assetType?: string): boolean {
  return !!assetType && assetType in BRANDING_ASSET_PREFIXES;
}

export type BlobPathFamily = 'avatar' | 'org-logo' | 'lms';

const BLOB_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*';

const BRANDING_FAMILY_PATTERNS: Readonly<Record<'avatar' | 'org-logo', RegExp>> = {
  'avatar': new RegExp(`^avatars/${BLOB_SEGMENT}$`),
  'org-logo': new RegExp(`^org-logos/${BLOB_SEGMENT}$`),
};

const ABSOLUTE_URL = /^https?:\/\//i;

export type BlobPathVerdict = 'own' | 'external' | 'foreign';

export function classifyBlobPath(value: string, family: BlobPathFamily): BlobPathVerdict {
  if (value === '') return 'foreign';
  if (ABSOLUTE_URL.test(value)) return 'external';

  for (const brandingFamily of ['avatar', 'org-logo'] as const) {
    if (!value.startsWith(BRANDING_ASSET_PREFIXES[brandingFamily])) continue;
    return family === brandingFamily && BRANDING_FAMILY_PATTERNS[brandingFamily].test(value)
      ? 'own'
      : 'foreign';
  }

  return family === 'lms' ? 'own' : 'foreign';
}

export function isBrandingAssetPath(blobPath: string): boolean {
  return classifyBlobPath(blobPath, 'avatar') === 'own'
    || classifyBlobPath(blobPath, 'org-logo') === 'own';
}

export function resolveAssetContainer(assetType?: string): { container: string; prefix: string } {
  return {
    container: process.env.AZURE_STORAGE_CONTAINER_NAME ?? 'lms-videos',
    prefix: (assetType && BRANDING_ASSET_PREFIXES[assetType]) ?? '',
  };
}

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

export interface BlobHead {
  ok: boolean;
  exists: boolean;
  contentLength: number | null;
  contentType: string | null;
}

const INCONCLUSIVE_HEAD: BlobHead = { ok: false, exists: false, contentLength: null, contentType: null };

function readHeader(res: Response, name: string): string | null {
  try {
    return res.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

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
