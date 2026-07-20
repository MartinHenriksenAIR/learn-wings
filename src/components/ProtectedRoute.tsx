import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { savePostLoginRedirect } from '@/lib/post-login-redirect';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requirePlatformAdmin?: boolean;
  requireOrgAdmin?: boolean;
  learnerOnly?: boolean;
}

export function ProtectedRoute({ 
  children, 
  requirePlatformAdmin = false,
  requireOrgAdmin = false,
  learnerOnly = false,
}: ProtectedRouteProps) {
  const { user, isLoading, isPlatformAdmin, effectiveIsPlatformAdmin, effectiveIsOrgAdmin } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }
  
  if (!user) {
    // Remember where the user was headed so Login can restore it after the
    // Entra round trip (deep links / Copy link, #16).
    savePostLoginRedirect(location.pathname + location.search + location.hash);
    return <Navigate to="/login" replace />;
  }
  
  // Redirect platform admins away from learner-only routes
  if (learnerOnly && effectiveIsPlatformAdmin) {
    return <Navigate to="/app/admin/platform/organizations" replace />;
  }
  
  // Check platform admin requirement
  if (requirePlatformAdmin && !isPlatformAdmin) {
    return <Navigate to="/app/dashboard" replace />;
  }
  
  // Check org admin requirement (platform admins have org admin privileges)
  if (requireOrgAdmin && !effectiveIsOrgAdmin) {
    return <Navigate to="/app/dashboard" replace />;
  }
  
  return <>{children}</>;
}
