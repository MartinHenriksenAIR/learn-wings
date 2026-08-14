import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

type CommunityGateState = 'loading' | 'allowed' | 'redirect';

export function useCommunityGate(options?: { allowPlatformAdmin?: boolean }): CommunityGateState {
  const { features, isLoading } = usePlatformSettings();
  const { effectiveIsPlatformAdmin } = useAuth();

  if (isLoading) return 'loading';
  if (features.community_enabled) return 'allowed';
  if (options?.allowPlatformAdmin && effectiveIsPlatformAdmin) return 'allowed';
  return 'redirect';
}
