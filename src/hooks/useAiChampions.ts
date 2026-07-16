import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Minimal shape OrgMembersTab needs from `/api/ai-champions`: just the
 * `user_id`s, which the tab folds into a `Set` to render the champion badge.
 * The endpoint returns richer rows (see AIChampionsList), but this hook's
 * contract is intentionally the narrow projection its one consumer uses.
 */
export interface AiChampionRow {
  user_id: string;
}

/**
 * The one way OrgMembersTab fetches `/api/ai-champions` from the frontend.
 *
 * Shares the `['ai-champions', orgId]` cache entry with AIChampionsList (same
 * endpoint, same request body), so both surfaces read one network response.
 */
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
