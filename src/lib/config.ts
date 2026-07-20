// Platform configuration
import { routes } from '@/lib/routes';

/**
 * Resolve the platform's public base URL.
 *
 * An explicit env pin wins (prod sets VITE_PLATFORM_BASE_URL at the domain
 * cutover); otherwise fall back to the given origin so links minted on
 * preview/local environments point at that environment instead of prod (#80).
 * Uses `||` (not `??`) so an empty-string env var also falls back, and strips
 * trailing slashes so path concatenation stays clean.
 */
export function resolvePlatformBaseUrl(envBaseUrl: string | undefined, origin: string): string {
  return (envBaseUrl || origin).replace(/\/+$/, '');
}

export const PLATFORM_BASE_URL = resolvePlatformBaseUrl(
  import.meta.env.VITE_PLATFORM_BASE_URL as string | undefined,
  window.location.origin,
);

/**
 * Generate an invite link using the platform's base URL
 */
export function getInviteLink(linkId: string): string {
  return `${PLATFORM_BASE_URL}${routes.auth.signup}?invite=${linkId}`;
}
