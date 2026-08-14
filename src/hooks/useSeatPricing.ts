import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { SeatPricing } from '@/lib/types';

export function useSeatPricing() {
  return useQuery({
    queryKey: queryKeys.seatPricing.all,
    queryFn: async () => {
      const { pricing } = await callApi<{ pricing: SeatPricing }>('/api/seat-pricing', {});
      return pricing;
    },
    staleTime: 5 * 60 * 1000,
  });
}
