import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMsal, useAccount } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { apiScopes } from '@/lib/msal-config';
import { callApi } from '@/lib/api-client';
import { clearPostLoginRedirect } from '@/lib/post-login-redirect';
import type { Profile, OrgMembership, Organization } from '@/lib/types';

export interface AppUser { id: string; tid: string; email: string; name: string; }
export type ViewMode = 'learner' | 'org_admin' | 'platform_admin';

interface AuthContextType {
  user: AppUser | null;
  profile: Profile | null;
  memberships: OrgMembership[];
  currentOrg: Organization | null;
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  isLoading: boolean;
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

  // True while the initial /api/user-context fetch for a cached account is
  // unresolved. Without this, a hard refresh has a window where `user` exists
  // but `profile` is null, and role guards read "not loaded yet" as "not
  // authorized" — bouncing every deep route to the dashboard (#16).
  const [contextLoading, setContextLoading] = useState(() => accounts.length > 0);

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
    try {
      const { profile: p, memberships: m } = await callApi<{ profile: Profile; memberships: OrgMembership[] }>('/api/user-context', {});
      setProfile(p);
      setMemberships(m);
      if (m.length > 0 && !currentOrg && !p?.is_platform_admin) {
        setCurrentOrg((m[0] as any).organization ?? null);
      }
    } catch {
      setProfile(null);
      setMemberships([]);
    } finally {
      setContextLoading(false);
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
      setContextLoading(false);
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
      isPlatformAdmin, isOrgAdmin, isLoading,
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
