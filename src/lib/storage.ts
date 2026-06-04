import { callApi } from '@/lib/api-client';

const LMS_ASSETS_SIGN_PREFIX = '/storage/v1/object/sign/lms-assets/';
const LMS_ASSETS_PUBLIC_PREFIX = '/storage/v1/object/public/lms-assets/';

/**
 * Get a signed URL for a storage file via the /api/asset-signed-url endpoint.
 * Expiry is fixed at 120 minutes server-side; the `_bucket` parameter is
 * retained for call-site source compatibility but is unused server-side
 * (the server resolves paths against the single Azure container).
 */
export async function getSignedUrl(
  _bucket: string,
  path: string,
): Promise<string | null> {
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
 * Get signed URLs for course content (videos and documents).
 */
export async function getSignedAssetUrl(storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  return getSignedUrl('lms-assets', storagePath);
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

  const signedUrl = await getSignedUrl('lms-assets', storagePath);
  if (signedUrl) return signedUrl;

  return /^https?:\/\//i.test(storedValue) ? storedValue : null;
}
