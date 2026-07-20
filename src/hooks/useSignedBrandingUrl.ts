import { useQuery } from '@tanstack/react-query';
import { getSignedBrandingUrl } from '@/lib/storage';
import { queryKeys } from '@/lib/query-keys';

/**
 * Resolves a stored branding-asset path (org logo / avatar) to a short-lived
 * signed display URL via /api/branding-asset-url.
 *
 * Cached per path (TanStack Query dedupes), so the same asset shown in several
 * places is signed once. Returns `undefined` while loading or when there is no
 * path — callers fall back to initials / a placeholder. `staleTime` is well
 * under the 120-minute SAS lifetime so a cached URL re-signs before it expires.
 */
export function useSignedBrandingUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.brandingAsset.signed(path ?? ''),
    queryFn: () => getSignedBrandingUrl(path ?? null),
    enabled: !!path,
    staleTime: 60 * 60 * 1000,
  });
}
