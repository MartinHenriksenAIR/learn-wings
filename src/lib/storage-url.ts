/**
 * The public Azure blob container for branding assets (org logos, avatars).
 * Per ADR-0008 this is the platform's only public (blob-level, unsigned)
 * container. Must match the backend `PUBLIC_CONTAINER` in
 * `functions/shared/blob.ts`.
 */
export const PUBLIC_CONTAINER = 'email-assets';

/**
 * Compose a public asset URL from VITE_STORAGE_BASE_URL, the public container
 * segment, and a container-relative storage path (e.g. `org-logos/<uuid>.png`).
 * VITE_STORAGE_BASE_URL is the account root (no container); the container
 * segment is added here. Throws if VITE_STORAGE_BASE_URL is not configured —
 * callers should let the error bubble so the failure surfaces in the upload UI
 * rather than silently writing a broken URL into the database.
 */
export function buildPublicUrl(storagePath: string): string {
  const base = import.meta.env.VITE_STORAGE_BASE_URL as string | undefined;
  if (!base) {
    throw new Error('VITE_STORAGE_BASE_URL is not configured');
  }
  return `${base.replace(/\/$/, '')}/${PUBLIC_CONTAINER}/${storagePath.replace(/^\//, '')}`;
}
