import { callApi } from '@/lib/api-client';

const LMS_ASSETS_SIGN_PREFIX = '/storage/v1/object/sign/lms-assets/';
const LMS_ASSETS_PUBLIC_PREFIX = '/storage/v1/object/public/lms-assets/';

/**
 * Get a signed URL for a storage file (videos, documents, thumbnails) via the
 * /api/asset-signed-url endpoint. Expiry is fixed at 120 minutes server-side;
 * the server resolves paths against the single Azure container.
 */
export async function getSignedAssetUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  try {
    const { url } = await callApi<{ url: string }>('/api/asset-signed-url', { blobPath: path });
    return url ?? null;
  } catch (e) {
    console.error('Error creating signed URL:', e);
    return null;
  }
}

/**
 * Extract lms-assets storage path from either a raw path or storage URL.
 */
export function extractLmsAssetPath(value: string | null): string | null {
  if (!value) return null;

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const isHttpUrl = /^https?:\/\//i.test(trimmedValue);
  if (!isHttpUrl) {
    return trimmedValue.replace(/^\/+/, '');
  }

  // Azure Blob Storage URL — host must end with exactly .blob.core.windows.net
  // Format: https://<account>.blob.core.windows.net/<container>/<blobPath>[?<sas>]
  // We parse with new URL() inside a try/catch so a malformed input can never throw.
  try {
    const parsed = new URL(trimmedValue);
    if (/\.blob\.core\.windows\.net$/i.test(parsed.hostname)) {
      // pathname is "/<container>/<blobPath>" — drop empty segments, then the container,
      // and keep the rest. filter(Boolean) makes the >= 2 check self-evident
      // (container + at least one blob segment) and normalizes stray double slashes.
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      if (pathSegments.length >= 2) {
        const blobPath = pathSegments.slice(1).map(decodeURIComponent).join('/');
        return blobPath || null;
      }
      return null;
    }
  } catch {
    // Malformed URL, or an undecodable percent-encoded blob segment (decodeURIComponent
    // throws on bad encoding) — fall through to the legacy storage-prefix / null branches below.
    // Such a stored value won't self-heal, but callers never see a throw.
  }

  if (trimmedValue.includes(LMS_ASSETS_SIGN_PREFIX)) {
    const [urlWithoutQuery] = trimmedValue.split('?');
    const extractedPath = urlWithoutQuery.split(LMS_ASSETS_SIGN_PREFIX)[1];
    return extractedPath ? decodeURIComponent(extractedPath) : null;
  }

  if (trimmedValue.includes(LMS_ASSETS_PUBLIC_PREFIX)) {
    const [urlWithoutQuery] = trimmedValue.split('?');
    const extractedPath = urlWithoutQuery.split(LMS_ASSETS_PUBLIC_PREFIX)[1];
    return extractedPath ? decodeURIComponent(extractedPath) : null;
  }

  return null;
}

/**
 * Resolve a stable thumbnail value to a fresh signed URL.
 * Handles raw storage paths and expired signed/public URLs.
 * Expiry is fixed at 120 minutes server-side.
 */
export async function getSignedLmsAssetUrl(
  storedValue: string | null,
): Promise<string | null> {
  if (!storedValue) return null;

  const storagePath = extractLmsAssetPath(storedValue);
  if (!storagePath) return storedValue;

  const signedUrl = await getSignedAssetUrl(storagePath);
  if (signedUrl) return signedUrl;

  return /^https?:\/\//i.test(storedValue) ? storedValue : null;
}
