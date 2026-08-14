import { routes } from '@/lib/routes';

export function resolvePlatformBaseUrl(envBaseUrl: string | undefined, origin: string): string {
  return (envBaseUrl || origin).replace(/\/+$/, '');
}

export const PLATFORM_BASE_URL = resolvePlatformBaseUrl(
  import.meta.env.VITE_PLATFORM_BASE_URL as string | undefined,
  window.location.origin,
);

export function getInviteLink(linkId: string): string {
  return `${PLATFORM_BASE_URL}${routes.auth.signup}?invite=${linkId}`;
}
