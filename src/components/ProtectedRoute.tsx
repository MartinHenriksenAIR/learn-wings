import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { savePostLoginRedirect } from '@/lib/post-login-redirect';
import { homeRouteFor, routes } from '@/lib/routes';
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
    savePostLoginRedirect(location.pathname + location.search + location.hash);
    return <Navigate to={routes.auth.login} replace />;
  }

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

  const homeRoute = homeRouteFor(effectiveIsPlatformAdmin);

  if (learnerOnly && effectiveIsPlatformAdmin) {
    return <Navigate to={homeRoute} replace />;
  }

  if (requirePlatformAdmin && !effectiveIsPlatformAdmin) {
    return <Navigate to={homeRoute} replace />;
  }

  if (requireOrgAdmin && !effectiveIsOrgAdmin) {
    return <Navigate to={homeRoute} replace />;
  }

  return <>{children}</>;
}
