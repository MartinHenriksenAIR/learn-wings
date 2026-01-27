import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Profile, OrgMembership, Organization, UserContext } from '@/lib/types';

export type ViewMode = 'learner' | 'org_admin' | 'platform_admin';

interface AuthContextType extends UserContext {
  user: User | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshUserContext: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  // View mode for platform admins to preview as different roles
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  effectiveIsPlatformAdmin: boolean;
  effectiveIsOrgAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<OrgMembership[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('platform_admin');

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isOrgAdmin = memberships.some(m => m.role === 'org_admin' && m.status === 'active');

  // Effective roles based on view mode (only platform admins can change view mode)
  const effectiveIsPlatformAdmin = isPlatformAdmin && viewMode === 'platform_admin';
  const effectiveIsOrgAdmin = isPlatformAdmin 
    ? viewMode === 'org_admin' || viewMode === 'platform_admin'
    : isOrgAdmin;

  const fetchUserContext = async (userId: string) => {
    try {
      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profileData) {
        setProfile(profileData as Profile);
      }

      // Fetch memberships with organizations
      const { data: membershipData } = await supabase
        .from('org_memberships')
        .select(`
          *,
          organization:organizations(*)
        `)
        .eq('user_id', userId)
        .eq('status', 'active');

      if (membershipData) {
        const typedMemberships = membershipData.map(m => ({
          ...m,
          organization: m.organization as Organization
        })) as OrgMembership[];
        setMemberships(typedMemberships);

        // Set current org to the first one if not set
        if (typedMemberships.length > 0 && !currentOrg) {
          setCurrentOrg(typedMemberships[0].organization!);
        }
      }
    } catch (error) {
      console.error('Error fetching user context:', error);
    }
  };

  const refreshUserContext = async () => {
    if (user) {
      await fetchUserContext(user.id);
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Defer Supabase calls with setTimeout to prevent deadlock
          setTimeout(() => {
            fetchUserContext(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setMemberships([]);
          setCurrentOrg(null);
        }
        setIsLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserContext(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setMemberships([]);
    setCurrentOrg(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        memberships,
        currentOrg,
        isPlatformAdmin,
        isOrgAdmin,
        isLoading,
        signIn,
        signUp,
        signOut,
        refreshUserContext,
        setCurrentOrg,
        viewMode,
        setViewMode,
        effectiveIsPlatformAdmin,
        effectiveIsOrgAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
