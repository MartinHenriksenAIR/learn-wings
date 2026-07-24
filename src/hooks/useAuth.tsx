import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMsal, useAccount } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { apiScopes } from '@/lib/msal-config';
import { callApi, ApiError } from '@/lib/api-client';
import i18n from '@/i18n';
import { clearPostLoginRedirect } from '@/lib/post-login-redirect';
import type { Profile, OrgMembership, Organization } from '@/lib/types';

interface AppUser { id: string; tid: string; email: string; name: string; }
export type ViewMode = 'learner' | 'org_admin' | 'platform_admin';

// Distinguishes a failed /api/user-context load from the (impossible) legitimate
// "no profile" state — the backend auto-provisions a profile on first login, so a
// settled-but-null profile is ALWAYS a failure. `'auth'` = a 401 (token rejected,
// re-auth may help); `'network'` = anything else (transient blip / 500 / offline).
export type ContextError = 'auth' | 'network' | null;

interface AuthContextType {
  user: AppUser | null;
  profile: Profile | null;
  memberships: OrgMembership[];
  currentOrg: Organization | null;
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  isLoading: boolean;
  contextError: ContextError;
  signIn: () => void;
  signOut: () => void;
  refreshUserContext: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  effectiveIsPlatformAdmin: boolean;
  effectiveIsOrgAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VIEW_MODES: readonly ViewMode[] = ['learner', 'org_admin', 'platform_admin'];
const VIEW_MODE_KEY = 'viewMode';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  // useAccount tracks the active account reactively
  const account = useAccount(accounts[0] ?? null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  // Persisted per tab so a full reload doesn't snap back to Platform Admin (#16)
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = sessionStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
      return stored && VIEW_MODES.includes(stored) ? stored : 'platform_admin';
    } catch {
      return 'platform_admin';
    }
  });
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    try {
      sessionStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage unavailable — mode still applies for this page lifetime.
    }
  };

  // Which account's /api/user-context fetch has settled (resolved OR failed).
  // `contextLoading` is DERIVED from it on every render: an account whose
  // context hasn't settled yet means "still loading". Without this, there is
  // a window where `user` exists but `profile` is null, and role guards read
  // "not loaded yet" as "not authorized" — bouncing every deep route to the
  // dashboard (#16). A mount-time snapshot (`accounts.length > 0`) is NOT
  // enough: the MSAL account can materialize only after the first render
  // (cold-login redirect return), reopening that window for admin deep links
  // (#79). Deliberately NOT tied to MSAL's `inProgress` (invariant from #16).
  const [contextSettledFor, setContextSettledFor] = useState<string | null>(null);
  const contextLoading = account !== null && contextSettledFor !== account.localAccountId;

  // Distinct error state for a failed user-context load (see ContextError above).
  // Kept separate from `profile === null` so guards/ProtectedRoute can tell a
  // real failure apart from the still-loading window and surface a retry (#232).
  const [contextError, setContextError] = useState<ContextError>(null);

  // isLoading is true while MSAL is processing a redirect or popup interaction,
  // OR while the user context (profile/memberships) is still resolving.
  const isLoading = inProgress !== InteractionStatus.None || contextLoading;

  const user: AppUser | null = account
    ? {
        id: (account.idTokenClaims?.oid as string) ?? account.localAccountId,
        tid: account.tenantId,
        email: account.username,
        name: account.name ?? '',
      }
    : null;

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isOrgAdmin = memberships.some(m => m.role === 'org_admin' && m.status === 'active');
  const effectiveIsPlatformAdmin = isPlatformAdmin && viewMode === 'platform_admin';
  const effectiveIsOrgAdmin = isPlatformAdmin
    ? viewMode === 'org_admin' || viewMode === 'platform_admin'
    : isOrgAdmin;

  const fetchUserContext = async () => {
    if (!account) return;
    // Clear any prior error at the start of a load so a retry that succeeds
    // (or is in flight) doesn't keep showing the stale error state.
    setContextError(null);
    try {
      // Send the browser-derived UI language so first-login provisioning can
      // stamp it on the new profile (#226); harmless on subsequent logins (the
      // server only reads it when creating a profile, never to overwrite one).
      const { profile: p, memberships: m } = await callApi<{ profile: Profile; memberships: OrgMembership[] }>('/api/user-context', { language: i18n.resolvedLanguage });
      setProfile(p);
      setMemberships(m);
      if (m.length > 0 && !currentOrg && !p?.is_platform_admin) {
        setCurrentOrg((m[0] as any).organization ?? null);
      }
    } catch (err) {
      // The backend auto-provisions a profile on first login, so this is always
      // a genuine failure (transient blip / MSAL hiccup / 500), never a "new
      // user" state. Log it — it used to be swallowed silently (#232) — and
      // record a distinct error state so guards can offer a retry instead of
      // spinning forever or silently redirecting an admin.
      console.error('Failed to load user context', err);
      setProfile(null);
      setMemberships([]);
      // A 401 means the token itself was rejected (re-auth may help); anything
      // else is treated as a transient/network failure that a plain retry fixes.
      setContextError(err instanceof ApiError && err.status === 401 ? 'auth' : 'network');
    } finally {
      setContextSettledFor(account.localAccountId);
    }
  };

  // Fetch profile whenever account changes or MSAL finishes an interaction
  useEffect(() => {
    if (account && inProgress === InteractionStatus.None) {
      fetchUserContext();
    }
    if (!account && inProgress === InteractionStatus.None) {
      setProfile(null);
      setMemberships([]);
      setCurrentOrg(null);
      setContextError(null);
      // Signed out: forget the settled marker so a future sign-in of the same
      // account starts in the loading state again.
      setContextSettledFor(null);
    }
  }, [account?.localAccountId, inProgress]);

  // loginRedirect sends user to Microsoft login page; MSAL handles the redirect back
  const signIn = () => {
    instance.loginRedirect({ scopes: apiScopes });
  };

  const signOut = () => {
    setProfile(null);
    setMemberships([]);
    setCurrentOrg(null);
    setContextError(null);
    // Per-tab persistence must not leak into the next login on this tab.
    try {
      sessionStorage.removeItem(VIEW_MODE_KEY);
    } catch {
      // Storage unavailable — nothing persisted to clear.
    }
    clearPostLoginRedirect();
    instance.logoutRedirect();
  };

  return (
    <AuthContext.Provider value={{
      user, profile, memberships, currentOrg,
      isPlatformAdmin, isOrgAdmin, isLoading, contextError,
      signIn, signOut, refreshUserContext: fetchUserContext,
      setCurrentOrg, viewMode, setViewMode,
      effectiveIsPlatformAdmin, effectiveIsOrgAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
