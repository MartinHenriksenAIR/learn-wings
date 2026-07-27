import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

type CommunityGateState = 'loading' | 'allowed' | 'redirect';

/**
 * Shared feature gate for the community pages (#255).
 *
 * - `'loading'`  — platform settings haven't resolved yet. Pages render
 *   normally (spinners/skeletons) rather than bouncing; deciding "disabled"
 *   here would redirect during the settings fetch race.
 * - `'allowed'`  — settings resolved and community is enabled (or the caller
 *   opted into the platform-admin bypass and the viewer is one).
 * - `'redirect'` — settings resolved and community is disabled for this
 *   viewer; the page should `<Navigate>` away (callers keep the one-line
 *   early return so the redirect target stays visible at the call site).
 *
 * `allowPlatformAdmin` — the gate is keyed on the VIEWER's effective flags
 * (platform + their currentOrg override). Pages that must stay reachable for
 * platform admins even when their own org has community disabled (e.g.
 * moderation deep links into another org's content) pass `true`; backend
 * authz already permits them.
 */
export function useCommunityGate(options?: { allowPlatformAdmin?: boolean }): CommunityGateState {
  const { features, isLoading } = usePlatformSettings();
  const { effectiveIsPlatformAdmin } = useAuth();

  if (isLoading) return 'loading';
  if (features.community_enabled) return 'allowed';
  if (options?.allowPlatformAdmin && effectiveIsPlatformAdmin) return 'allowed';
  return 'redirect';
}
