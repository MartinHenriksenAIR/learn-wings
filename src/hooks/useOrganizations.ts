import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Organization } from '@/lib/types';

interface UseOrganizationsOptions {
  /** Gate the fetch (e.g. platform admins only). Defaults to true. */
  enabled?: boolean;
  /**
   * Per-observer staleTime override. Defaults to 60s — the org list rarely
   * changes mid-session, so consumers mounting within a minute share one fetch.
   */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/organizations` from the frontend.
 *
 * All consumers share the `['organizations']` TanStack Query cache entry, so
 * five pages mounting in sequence produce one network request instead of five.
 * Site-specific concerns (sorting, projections, error toasts) stay at the site.
 */
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
