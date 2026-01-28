import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
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
  
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // Redirect platform admins away from learner-only routes
  if (learnerOnly && effectiveIsPlatformAdmin) {
    return <Navigate to="/app/admin/organizations" replace />;
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
