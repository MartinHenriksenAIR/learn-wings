import { useQuery } from '@tanstack/react-query';
import { getSignedBrandingUrl } from '@/lib/storage';
import { queryKeys } from '@/lib/query-keys';

export function useSignedBrandingUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.brandingAsset.signed(path ?? ''),
    queryFn: () => getSignedBrandingUrl(path ?? null),
    enabled: !!path,
    staleTime: 60 * 60 * 1000,
  });
}
