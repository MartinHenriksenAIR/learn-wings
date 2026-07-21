import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface PlatformAdmin {
  id: string;
  full_name: string;
  email: string | null;
}

interface UsePlatformAdminsOptions {
  /** Gate the fetch — the caller only mounts this list on the admins tab. */
  enabled?: boolean;
}

/**
 * The one way to fetch `/api/platform-admins` from the frontend — the list of
 * users holding platform-admin (#128). All consumers share the
 * `['platform-admins']` TanStack Query cache entry.
 */
export function usePlatformAdmins(options: UsePlatformAdminsOptions = {}) {
  return useQuery({
    queryKey: queryKeys.platformAdmins.all,
    queryFn: async () => {
      const { admins } = await callApi<{ admins: PlatformAdmin[] }>('/api/platform-admins', {});
      return Array.isArray(admins) ? admins : [];
    },
    staleTime: 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
