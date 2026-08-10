import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * An org's raw feature-overrides jsonb (#369). Values are booleans keyed by
 * feature. Kept as an open record on purpose: a settings save merges onto this
 * so it never drops a key it doesn't manage (e.g. a future org-only flag), and
 * it carries the org-only `leaderboard_enabled` key that usePlatformSettings'
 * fixed FeatureSettings type does not model.
 */
export type OrgFeatures = Record<string, boolean>;

/**
 * The one way to read an org's stored feature overrides verbatim.
 *
 * Distinct from usePlatformSettings, which composes platform + org flags into
 * the *effective* gate used across the app. This hook returns the org's stored
 * values as-is (or null when the org has no settings row) — the shape the org
 * settings form both seeds from and writes back.
 */
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
