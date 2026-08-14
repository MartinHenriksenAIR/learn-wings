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
  const account = useAccount(accounts[0] ?? null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
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
    }
  };

  const [contextSettledFor, setContextSettledFor] = useState<string | null>(null);
  const contextLoading = account !== null && contextSettledFor !== account.localAccountId;

  const [contextError, setContextError] = useState<ContextError>(null);

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
    setContextError(null);
    try {
      const { profile: p, memberships: m } = await callApi<{ profile: Profile; memberships: OrgMembership[] }>('/api/user-context', { language: i18n.resolvedLanguage });
      setProfile(p);
      setMemberships(m);
      if (m.length > 0 && !currentOrg && !p?.is_platform_admin) {
        const preferred = m.find((x) => (x as any).organization?.kind !== 'individual') ?? m[0];
        setCurrentOrg((preferred as any).organization ?? null);
      }
    } catch (err) {
      console.error('Failed to load user context', err);
      setProfile(null);
      setMemberships([]);
      setContextError(err instanceof ApiError && err.status === 401 ? 'auth' : 'network');
    } finally {
      setContextSettledFor(account.localAccountId);
    }
  };

  useEffect(() => {
    if (account && inProgress === InteractionStatus.None) {
      fetchUserContext();
    }
    if (!account && inProgress === InteractionStatus.None) {
      setProfile(null);
      setMemberships([]);
      setCurrentOrg(null);
      setContextError(null);
      setContextSettledFor(null);
    }
  }, [account?.localAccountId, inProgress]);

  const signIn = () => {
    instance.loginRedirect({ scopes: apiScopes });
  };

  const signOut = () => {
    setProfile(null);
    setMemberships([]);
    setCurrentOrg(null);
    setContextError(null);
    try {
      sessionStorage.removeItem(VIEW_MODE_KEY);
    } catch {
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
