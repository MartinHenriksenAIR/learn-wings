import { CSSProperties, Fragment, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useAuth } from '@/hooks/useAuth';
import { useViewModeLabels } from '@/components/layout/view-mode-labels';
import { routes } from '@/lib/routes';

// Default hrefs for common intermediate crumbs, keyed by a STABLE route id — not
// the display label. Keying by the English label meant the Danish locale (whose
// translated label never matched) silently dropped the link; a stable id keeps
// the default href resolving in every locale.
const DEFAULT_BREADCRUMB_HREFS = {
  community: routes.community.feed,
  ideaLibrary: routes.community.ideas,
} as const;

export type BreadcrumbHrefKey = keyof typeof DEFAULT_BREADCRUMB_HREFS;

export interface Crumb {
  label: string;
  /** Explicit href — wins over `hrefKey`. */
  href?: string;
  /** Stable route id to resolve a default href, locale-independently. */
  hrefKey?: BreadcrumbHrefKey;
}

interface AppLayoutProps {
  children: ReactNode;
  breadcrumbs?: Crumb[];
  title?: string;
}

const CRUMB_LINK_CLASSES = 'font-medium text-muted-foreground transition-colors hover:text-primary';

export function AppLayout({ children, breadcrumbs = [], title }: AppLayoutProps) {
  const { effectiveIsPlatformAdmin, isPlatformAdmin, viewMode } = useAuth();
  const { t } = useTranslation();

  // Platform admins go to Organizations, others go to Dashboard
  const homeHref = effectiveIsPlatformAdmin ? routes.platformAdmin.organizations : routes.learner.dashboard;

  const viewModeLabels = useViewModeLabels();

  // Surface the existing view-mode state as a header chip when it differs from the real role
  const showViewingAsChip = isPlatformAdmin && viewMode !== 'platform_admin';

  return (
    <SidebarProvider style={{ '--sidebar-width': '252px' } as CSSProperties}>
      <div className="flex h-svh w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-w-0 flex-1">
          <header className="flex h-[58px] shrink-0 items-center gap-2 border-b bg-card px-7">
            <SidebarTrigger className="-ml-2" />
            <Breadcrumb>
              <BreadcrumbList className="text-[13px]">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild className={CRUMB_LINK_CLASSES}>
                    <Link to={homeHref}>{t('nav.home')}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  const resolvedHref = crumb.href ?? (crumb.hrefKey ? DEFAULT_BREADCRUMB_HREFS[crumb.hrefKey] : undefined);
                  return (
                    <Fragment key={index}>
                      <BreadcrumbSeparator className="text-[#c3c7d3] [&>svg]:size-[13px]" />
                      <BreadcrumbItem>
                        {!isLast && resolvedHref ? (
                          <BreadcrumbLink asChild className={CRUMB_LINK_CLASSES}>
                            <Link to={resolvedHref}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage className="font-bold text-foreground">{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
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
