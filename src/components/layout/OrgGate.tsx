import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout, type Crumb } from '@/components/layout/AppLayout';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';

interface OrgGateProps {
  /** Breadcrumbs forwarded to AppLayout in the gate states (omit to render none). */
  breadcrumbs?: Crumb[];
  /** i18n key for the no-org heading. */
  titleKey: string;
  /** i18n key for the no-org description. */
  descriptionKey: string;
  children?: ReactNode;
}

/**
 * Org-scoped page gate: renders the profile-gated loading spinner while the
 * signed-in user's context is still resolving (useOrgGuard — don't flash
 * "No Organization Selected" during auth bootstrap), the no-org empty state
 * when context settled without an organization, and `children` otherwise.
 *
 * Note: TypeScript can't narrow `currentOrg` across a component boundary, so
 * pages that dereference the org in their main JSX should keep the guard as an
 * early return — `if (orgGuard === 'loading' || !currentOrg) return <OrgGate …/>`
 * — rather than wrapping their content as children (eager JSX evaluation would
 * dereference a null org during the gate states).
 */
export function OrgGate({ breadcrumbs, titleKey, descriptionKey, children }: OrgGateProps) {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();

  if (orgGuard === 'loading') {
    return (
      <AppLayout breadcrumbs={breadcrumbs}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout breadcrumbs={breadcrumbs}>
        <div className="py-12 text-center">
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t(titleKey)}
          </h1>
          <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
        </div>
      </AppLayout>
    );
  }

  return <>{children}</>;
}
