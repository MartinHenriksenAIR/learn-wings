import { useAuth } from '@/hooks/useAuth';

export type OrgGuardState = 'loading' | 'no-org' | 'ready';

/**
 * The canonical profile-gated org loading guard (Dashboard pattern, #87).
 *
 * - `'loading'` — a user is signed in but `/api/user-context` hasn't resolved
 *   yet (`profile` is null). Keep showing a spinner; deciding "no org" here
 *   would flash the empty state (or bounce the route) during auth bootstrap.
 * - `'no-org'`  — context is resolved (or nobody is signed in) and there is no
 *   current organization. Show the page's no-org empty state.
 * - `'ready'`   — `currentOrg` is set; safe to fetch org-scoped data.
 *
 * Note: `'ready'` guarantees `currentOrg` is non-null at runtime, but TypeScript
 * can't narrow across the hook boundary — keep a `!currentOrg` check where the
 * org's fields are used, or read `currentOrg` after an explicit null check.
 */
export function useOrgGuard(): OrgGuardState {
  const { user, profile, currentOrg } = useAuth();

  if (user && !profile) return 'loading';
  if (!currentOrg) return 'no-org';
  return 'ready';
}
