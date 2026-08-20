import { CSSProperties, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Eye } from 'lucide-react';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useViewModeLabels } from '@/components/layout/view-mode-labels';
import { routes } from '@/lib/routes';
import { parentRouteFor } from '@/lib/parent-routes';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  headerLabel?: string;
}

export function AppLayout({ children, title, headerLabel }: AppLayoutProps) {
  const { effectiveIsPlatformAdmin, isPlatformAdmin, viewMode } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const homeHref = effectiveIsPlatformAdmin ? routes.platformAdmin.organizations : routes.learner.dashboard;

  const viewModeLabels = useViewModeLabels();

  const showViewingAsChip = isPlatformAdmin && viewMode !== 'platform_admin';

  const parentRoute = parentRouteFor(location.pathname, homeHref);

  const showBack = parentRoute !== null;

  const label = headerLabel ?? title;

  const handleBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
      return;
    }
    navigate(parentRoute ?? homeHref);
  };

  return (
    <SidebarProvider style={{ '--sidebar-width': '252px' } as CSSProperties}>
      <div className="flex h-svh w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-w-0 flex-1">
          <header className="flex h-[58px] shrink-0 items-center gap-2 border-b bg-card px-7">
            <SidebarTrigger className="-ml-2" />
            {showBack && (
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t('common.back')}
              </Button>
            )}
            {label && <span className="text-[13px] font-bold text-foreground">{label}</span>}
            <div className="flex-1" />
            {showViewingAsChip && (
              <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-[7px] border border-[#d7ddf4] bg-accent px-[13px] py-1.5 text-xs font-bold text-accent-foreground">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                {t('nav.viewingAs', { role: viewModeLabels[viewMode] })}
              </span>
            )}
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1140px] px-8 pb-14 pt-[30px]">
              {title && (
                <h1 className="mb-6 font-display text-[26px] font-extrabold tracking-[-0.02em]">
                  {title}
                </h1>
              )}
              {children}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
