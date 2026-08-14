import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { fetchPosts } from '@/lib/community-api';
import type { CommunityScope } from '@/lib/community-types';

export function useCommunityEvents(scope: CommunityScope, orgId?: string) {
  return useQuery({
    queryKey: queryKeys.communityPosts.list(scope, orgId, '', '', []),
    queryFn: async () => {
      const posts = await fetchPosts({
        scope,
        org_id: scope === 'org' ? orgId : undefined,
      });
      return Array.isArray(posts) ? posts : [];
    },
    enabled: scope === 'global' || !!orgId,
  });
}
