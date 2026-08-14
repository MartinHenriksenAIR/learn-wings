import { useQuery } from '@tanstack/react-query';
import { callApi, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Organization } from '@/lib/types';

export function useOrgDetail(orgId: string | undefined) {
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
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
