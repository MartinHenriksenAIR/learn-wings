import { useAuth } from '@/hooks/useAuth';

type OrgGuardState = 'loading' | 'no-org' | 'ready';

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
 *
 * Defensive against a failed user-context load (#232): when `contextError` is
 * set, the load has SETTLED (in failure), so we must not report `'loading'` —
 * that would strand an eternal spinner. In practice `ProtectedRoute` short-
 * circuits on `contextError` before any org-scoped page mounts, so this branch
 * is a belt-and-suspenders fallback; it resolves to `'no-org'` (a terminal
 * empty state every consumer already renders) rather than spinning forever.
 */
export function useOrgGuard(): OrgGuardState {
  const { user, profile, currentOrg, contextError } = useAuth();

  if (user && !profile && !contextError) return 'loading';
  if (!currentOrg) return 'no-org';
  return 'ready';
}
