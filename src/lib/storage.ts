import { callApi } from '@/lib/api-client';

const LMS_ASSETS_SIGN_PREFIX = '/storage/v1/object/sign/lms-assets/';
const LMS_ASSETS_PUBLIC_PREFIX = '/storage/v1/object/public/lms-assets/';

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

export async function getSignedBrandingUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { url } = await callApi<{ url: string }>('/api/branding-asset-url', { blobPath: path });
    return url ?? null;
  } catch (e) {
    console.error('Error signing branding asset URL:', e);
    return null;
  }
}

export function extractLmsAssetPath(value: string | null): string | null {
  if (!value) return null;

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const isHttpUrl = /^https?:\/\//i.test(trimmedValue);
  if (!isHttpUrl) {
    return trimmedValue.replace(/^\/+/, '');
  }

  try {
    const parsed = new URL(trimmedValue);
    if (/\.blob\.core\.windows\.net$/i.test(parsed.hostname)) {
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      if (pathSegments.length >= 2) {
        const blobPath = pathSegments.slice(1).map(decodeURIComponent).join('/');
        return blobPath || null;
      }
      return null;
    }
  } catch {
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
