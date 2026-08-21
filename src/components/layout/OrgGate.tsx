import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';

interface OrgGateProps {
  headerLabel?: string;
  titleKey: string;
  descriptionKey: string;
  children?: ReactNode;
}

export function OrgGate({ headerLabel, titleKey, descriptionKey, children }: OrgGateProps) {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();

  if (orgGuard === 'loading') {
    return (
      <AppLayout headerLabel={headerLabel}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout headerLabel={headerLabel}>
        <div className="py-12 text-center">
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t(titleKey)}
          </h1>
          <p className="text-sm text-legacy-muted-foreground">{t(descriptionKey)}</p>
        </div>
      </AppLayout>
    );
  }

  return <>{children}</>;
}
