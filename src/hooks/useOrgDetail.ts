import { useQuery } from '@tanstack/react-query';
import { callApi, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Organization } from '@/lib/types';

interface UseOrgDetailOptions {
  /** Gate the fetch. Defaults to true when orgId is provided. */
  enabled?: boolean;
  /**
   * Per-observer staleTime override. Defaults to 60s — org details rarely
   * change mid-session.
   */
  staleTime?: number;
}

/**
 * The one way to fetch a single org's details via `/api/organizations` from
 * the frontend (platform-admin use-case).
 *
 * The endpoint accepts `{ orgId }` and returns `{ organization }` — distinct
 * from `useOrganizations` which passes `{}` and returns the full list. The
 * two behaviors live on the same endpoint but are NOT request-equivalent, so
 * they use separate cache keys rather than sharing `useOrganizations`'s cache.
 *
 * 404 responses are surfaced as a resolved `null` value so consumers can
 * distinguish "not found" from a thrown error.
 */
export function useOrgDetail(orgId: string | undefined, options: UseOrgDetailOptions = {}) {
  return useQuery({
    queryKey: queryKeys.orgDetail.detail(orgId),
    queryFn: async () => {
      try {
        const { organization } = await callApi<{ organization: Organization }>(
          '/api/organizations',
          { orgId },
        );
        return organization ?? null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: options.enabled ?? !!orgId,
  });
}
