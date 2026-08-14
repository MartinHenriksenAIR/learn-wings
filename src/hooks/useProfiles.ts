import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Profile } from '@/lib/types';

interface UseProfilesOptions {
  enabled?: boolean;
}

export function useProfiles(options: UseProfilesOptions = {}) {
  return useQuery({
    queryKey: queryKeys.profiles.all,
    queryFn: async () => {
      const { profiles } = await callApi<{ profiles: Profile[] }>('/api/profiles', {});
      return Array.isArray(profiles) ? profiles : [];
    },
    staleTime: 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
