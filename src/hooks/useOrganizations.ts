import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Organization } from '@/lib/types';

interface UseOrganizationsOptions {
  enabled?: boolean;
  staleTime?: number;
}

export function useOrganizations(options: UseOrganizationsOptions = {}) {
  return useQuery({
    queryKey: queryKeys.organizations.all,
    queryFn: async () => {
      const { organizations } = await callApi<{ organizations: Organization[] }>(
        '/api/organizations',
        {},
      );
      return Array.isArray(organizations) ? organizations : [];
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
