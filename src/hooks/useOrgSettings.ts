import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export type OrgFeatures = Record<string, boolean>;

export function useOrgSettings(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgSettings.detail(orgId),
    queryFn: async () => {
      const { settings } = await callApi<{
        settings: { org_id: string; features: OrgFeatures } | null;
      }>('/api/org-settings', { orgId });
      return settings?.features ?? null;
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });
}
