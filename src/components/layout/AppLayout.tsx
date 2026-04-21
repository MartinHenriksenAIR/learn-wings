import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useAuth } from '@/hooks/useAuth';

interface AppLayoutProps {
  children: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  title?: string;
}

// Default href map for common breadcrumb labels that don't have an explicit href
const DEFAULT_BREADCRUMB_HREFS: Record<string, string> = {
  'Community': '/app/community',
  'Courses': '/app/courses',
  'Idea Library': '/app/community/ideas',
  'Resources': '/app/community/resources',
  'Organizations': '/app/admin/organizations',
  'Team Members': '/app/team',
  'Organization Settings': '/app/org/settings',
};

export function AppLayout({ children, breadcrumbs = [], title }: AppLayoutProps) {
  const { effectiveIsPlatformAdmin } = useAuth();

  // Platform admins go to Organizations, others go to Dashboard
  const homeHref = effectiveIsPlatformAdmin ? '/app/admin/organizations' : '/app/dashboard';

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex-1">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={homeHref}>Home</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  const resolvedHref = crumb.href ?? DEFAULT_BREADCRUMB_HREFS[crumb.label];
                  return (
                    <>
                      <BreadcrumbSeparator key={`sep-${index}`} />
                      <BreadcrumbItem key={index}>
                        {!isLast && resolvedHref ? (
                          <BreadcrumbLink asChild>
                            <Link to={resolvedHref}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                    </>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="container py-6">
              {title && (
                <h1 className="mb-6 font-display text-2xl font-bold tracking-tight">
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
