import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { Invitation } from '@/lib/types';

type InvitationScope = 'platform' | 'org';

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
