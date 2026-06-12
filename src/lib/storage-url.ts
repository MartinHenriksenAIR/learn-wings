/**
 * Compose a public asset URL from VITE_STORAGE_BASE_URL + storage path.
 * Throws if VITE_STORAGE_BASE_URL is not configured — callers should let the
 * error bubble so the failure surfaces in the upload UI rather than silently
 * writing a broken URL into the database.
 */
export function buildPublicUrl(storagePath: string): string {
  const base = import.meta.env.VITE_STORAGE_BASE_URL as string | undefined;
  if (!base) {
    throw new Error('VITE_STORAGE_BASE_URL is not configured');
  }
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}
