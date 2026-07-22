import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { fetchPosts } from '@/lib/community-api';
import type { CommunityScope } from '@/lib/community-types';

/**
 * Fetch community posts for one scope, for the Events tab (#125).
 *
 * Thin wrapper over `/api/community-posts` (modeled on `useOrganizations`):
 * the events-category filter, upcoming-only cut, and soonest-first sort are
 * call-site derivations (`EventsTab`), per the frontend rule that reshaping
 * stays at the call site. Reuses the `communityPosts.list` key with empty
 * filter args so the unfiltered feed query and this share one cache entry.
 * Gates on org presence so the `'org'` variant stays idle until the user
 * actually belongs to an org.
 */
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
