import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface AiChampionRow {
  user_id: string;
}

export function useAiChampions(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.aiChampions.list(orgId),
    queryFn: async () => {
      const { champions } = await callApi<{ champions: AiChampionRow[] }>(
        '/api/ai-champions',
        { orgId },
      );
      return Array.isArray(champions) ? champions : [];
    },
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
