import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SeatRequest } from '@/lib/types';

/** The one way to read an org's seat requests. Gated on orgId. */
export function useSeatRequests(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.seatRequests.list(orgId),
    queryFn: async () => {
      const { requests } = await callApi<{ requests: SeatRequest[] }>('/api/seat-requests', { orgId });
      return Array.isArray(requests) ? requests : [];
    },
    enabled: !!orgId,
  });
}
