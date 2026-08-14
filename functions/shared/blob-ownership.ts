import { query } from './db';
import { classifyBlobPath, type BlobPathFamily } from './blob';
import { pathExtensionAllowed, type UploadCandidate } from './upload-limits';

const REJECTION = 'Invalid upload path';

const REFERENCING_ROWS_SQL = `
      SELECT video_storage_path    AS path FROM lessons       WHERE video_storage_path    = ANY($1::text[])
UNION SELECT azure_blob_path       AS path FROM lessons       WHERE azure_blob_path       = ANY($1::text[])
UNION SELECT document_storage_path AS path FROM lessons       WHERE document_storage_path = ANY($1::text[])
UNION SELECT thumbnail_url         AS path FROM courses       WHERE thumbnail_url         = ANY($1::text[])
UNION SELECT logo_url              AS path FROM organizations WHERE logo_url              = ANY($1::text[])
UNION SELECT avatar_url            AS path FROM profiles      WHERE avatar_url            = ANY($1::text[])
`;

async function referencedSubset(paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await query<{ path: string | null }>(REFERENCING_ROWS_SQL, [[...paths]]);
  const referenced = new Set<string>();
  for (const row of rows) {
    if (typeof row?.path === 'string' && row.path !== '') referenced.add(row.path);
  }
  return referenced;
}

function isStoredPath(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

export async function assertBindablePaths(
  candidates: readonly UploadCandidate[],
  previousPaths: readonly (string | null | undefined)[] = [],
): Promise<string | null> {
  const alreadyOnRow = new Set(previousPaths.filter(isStoredPath));

  const fresh: string[] = [];
  const seen = new Set<string>();
  for (const { path, kind, family } of candidates) {
    if (!isStoredPath(path)) continue;
    if (alreadyOnRow.has(path)) continue;

    const verdict = classifyBlobPath(path, family);
    if (verdict === 'foreign') {
      console.warn(`[blob-ownership] refusing a ${family} write of an out-of-family path: ${JSON.stringify(path)}`);
      return REJECTION;
    }
    if (verdict === 'external') continue;

    if (!pathExtensionAllowed(path, kind)) {
      console.warn(`[blob-ownership] refusing a ${kind} write of path: ${JSON.stringify(path)}`);
      return REJECTION;
    }

    if (seen.has(path)) continue;
    seen.add(path);
    fresh.push(path);
  }

  if (fresh.length === 0) return null;

  const claimed = await referencedSubset(fresh);
  if (claimed.size > 0) {
    console.warn('[blob-ownership] refusing to bind path(s) another row references:', [...claimed]);
    return REJECTION;
  }
  return null;
}

export async function releasablePaths(
  paths: readonly (string | null | undefined)[],
  family: BlobPathFamily,
): Promise<string[]> {
  const own = [...new Set(paths.filter(isStoredPath))]
    .filter((path) => classifyBlobPath(path, family) === 'own');
  if (own.length === 0) return [];

  try {
    const referenced = await referencedSubset(own);
    return own.filter((path) => !referenced.has(path));
  } catch (err: unknown) {
    console.warn(
      '[blob-ownership] could not confirm the path(s) are unreferenced; leaving them:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function isBlobReleasable(path: string, family: BlobPathFamily): Promise<boolean> {
  return (await releasablePaths([path], family)).length === 1;
}
