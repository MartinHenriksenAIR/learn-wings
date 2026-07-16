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

interface UseInvitationsOptions {
  /** Gate the fetch. Defaults to true when orgId is provided. */
  enabled?: boolean;
  /**
   * Per-observer staleTime override. Defaults to 30s — invitations change
   * when members are added/invited, so a shorter window keeps the view fresh.
   */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/invitations` from the frontend.
 *
 * The `scope` parameter controls the authorization path on the server:
 * platform admins pass `'platform'`; org admins pass `'org'`. The cache
 * key encodes scope + orgId so different scopes never collide.
 *
 * Site-specific concerns (filtering, error toasts) stay at the site.
 */
export function useInvitations(
  orgId: string | undefined,
  scope: InvitationScope,
  options: UseInvitationsOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.invitations.list(orgId, scope),
    queryFn: async () => {
      const { invitations } = await callApi<{ invitations: Invitation[] }>(
        '/api/invitations',
        { scope, orgId },
      );
      return Array.isArray(invitations) ? invitations : [];
    },
    staleTime: options.staleTime ?? 30 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
