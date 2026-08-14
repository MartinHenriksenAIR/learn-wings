import { useAuth } from '@/hooks/useAuth';

type OrgGuardState = 'loading' | 'no-org' | 'ready';

export function useOrgGuard(): OrgGuardState {
  const { user, profile, currentOrg, contextError } = useAuth();

  if (user && !profile && !contextError) return 'loading';
  if (!currentOrg) return 'no-org';
  return 'ready';
}
