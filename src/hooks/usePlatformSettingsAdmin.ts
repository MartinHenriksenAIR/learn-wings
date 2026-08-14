import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

type PlatformSetting = { key: string; value: Record<string, unknown> };

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
