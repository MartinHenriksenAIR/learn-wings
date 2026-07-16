import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

type PlatformSetting = { key: string; value: Record<string, unknown> };

/**
 * The one way to fetch `/api/platform-settings` from the frontend.
 *
 * All consumers share the `['platform-settings']` TanStack Query cache entry,
 * so multiple mounts produce one network request instead of one per mount.
 * Named `usePlatformSettingsAdmin` to avoid colliding with the theming context
 * hook `usePlatformSettings` in `src/hooks/usePlatformSettings.tsx`.
 */
export function usePlatformSettingsAdmin() {
  return useQuery({
    queryKey: queryKeys.platformSettings.all,
    queryFn: async () => {
      const { settings } = await callApi<{ settings: PlatformSetting[] }>(
        '/api/platform-settings',
        {},
      );
      return Array.isArray(settings) ? settings : [];
    },
    staleTime: 60 * 1000,
  });
}
