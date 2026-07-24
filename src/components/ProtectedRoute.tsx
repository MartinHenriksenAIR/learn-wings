import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { savePostLoginRedirect } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

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
  const {
    user,
    isLoading,
    isPlatformAdmin,
    effectiveIsPlatformAdmin,
    effectiveIsOrgAdmin,
    contextError,
    refreshUserContext,
    signIn,
  } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();

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
    return <Navigate to={routes.auth.login} replace />;
  }

  // The user is signed in but /api/user-context failed to load. Surface it with
  // a retry BEFORE any authorization/redirect logic below — otherwise a platform
  // admin whose context blipped is read as `!isPlatformAdmin` and silently
  // bounced to the learner dashboard (#232). A settled-but-null profile is always
  // a failure here (the backend auto-provisions on first login).
  if (contextError) {
    const isAuth = contextError === 'auth';
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title={t('contextError.title')}
          description={isAuth ? t('contextError.authDescription') : t('contextError.networkDescription')}
          action={
            isAuth ? (
              <Button onClick={() => signIn()}>{t('contextError.signInAgain')}</Button>
            ) : (
              <Button onClick={() => { void refreshUserContext(); }}>{t('contextError.retry')}</Button>
            )
          }
        />
      </div>
    );
  }

  // Redirect platform admins away from learner-only routes
  if (learnerOnly && effectiveIsPlatformAdmin) {
    return <Navigate to={routes.platformAdmin.organizations} replace />;
  }
  
  // Check platform admin requirement
  if (requirePlatformAdmin && !isPlatformAdmin) {
    return <Navigate to={routes.learner.dashboard} replace />;
  }
  
  // Check org admin requirement (platform admins have org admin privileges)
  if (requireOrgAdmin && !effectiveIsOrgAdmin) {
    return <Navigate to={routes.learner.dashboard} replace />;
  }
  
  return <>{children}</>;
}
