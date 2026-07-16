import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export type PlatformSetting = { key: string; value: Record<string, unknown> };

interface UsePlatformSettingsAdminOptions {
  /** Gate the fetch (e.g. platform admins only). Defaults to true. */
  enabled?: boolean;
  /**
   * Per-observer staleTime override. Defaults to 60s — platform settings
   * rarely change mid-session, so consumers mounting within a minute share
   * one fetch.
   */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/platform-settings` from the frontend.
 *
 * All consumers share the `['platform-settings']` TanStack Query cache entry,
 * so multiple mounts produce one network request instead of one per mount.
 * Named `usePlatformSettingsAdmin` to avoid colliding with the theming context
 * hook `usePlatformSettings` in `src/hooks/usePlatformSettings.tsx`.
 */
export function usePlatformSettingsAdmin(options: UsePlatformSettingsAdminOptions = {}) {
  return useQuery({
    queryKey: queryKeys.platformSettings.all,
    queryFn: async () => {
      const { settings } = await callApi<{ settings: PlatformSetting[] }>(
        '/api/platform-settings',
        {},
      );
      return Array.isArray(settings) ? settings : [];
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
