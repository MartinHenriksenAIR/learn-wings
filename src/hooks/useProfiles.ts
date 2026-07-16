import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Profile } from '@/lib/types';

/**
 * The one way to fetch `/api/profiles` from the frontend.
 *
 * All consumers share the `['profiles']` TanStack Query cache entry, so
 * OrganizationsManager and OrganizationDetail both mounting produce one
 * network request instead of two. Site-specific concerns (filtering,
 * projections, error toasts) stay at the site.
 */
export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles.all,
    queryFn: async () => {
      const { profiles } = await callApi<{ profiles: Profile[] }>('/api/profiles', {});
      return Array.isArray(profiles) ? profiles : [];
    },
    staleTime: 60 * 1000,
  });
}
