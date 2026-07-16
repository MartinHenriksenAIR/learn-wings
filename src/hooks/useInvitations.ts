import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Invitation } from '@/lib/types';

/**
 * Scope passed to `/api/invitations`.
 * - `'platform'` — used by platform-admin views (OrganizationDetail).
 * - `'org'`      — used by org-admin views (OrgMembersTab).
 *
 * The two scopes produce different server-side authorization paths, so the
 * cache key encodes both orgId and scope to prevent cross-scope collisions.
 */
export type InvitationScope = 'platform' | 'org';

/**
 * The one way to fetch `/api/invitations` from the frontend.
 *
 * The `scope` parameter controls the authorization path on the server:
 * platform admins pass `'platform'`; org admins pass `'org'`. The cache
 * key encodes scope + orgId so different scopes never collide.
 *
 * Site-specific concerns (filtering, error toasts) stay at the site.
 */
export function useInvitations(orgId: string | undefined, scope: InvitationScope) {
  return useQuery({
    queryKey: queryKeys.invitations.list(orgId, scope),
    queryFn: async () => {
      const { invitations } = await callApi<{ invitations: Invitation[] }>(
        '/api/invitations',
        { scope, orgId },
      );
      return Array.isArray(invitations) ? invitations : [];
    },
    staleTime: 30 * 1000,
    enabled: !!orgId,
  });
}
