import { useTranslation } from 'react-i18next';
import { Building2, ArrowLeft, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';

interface OrgNotFoundScreenProps {
  /** True when the org query erred (retryable); false for an honest 404. */
  loadFailed: boolean;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * The not-found / load-failed screen shown when the org can't be resolved.
 * A 404 renders an honest not-found (no retry); a query error renders the
 * load-failed variant with a "Try Again" action.
 */
export function OrgNotFoundScreen({ loadFailed, onRetry, onBack }: OrgNotFoundScreenProps) {
  const { t } = useTranslation();

  return (
    <AppLayout
      title={loadFailed ? t('orgDetail.loadFailedTitle') : t('orgDetail.notFoundTitle')}
      breadcrumbs={[
        { label: t('organizations.title'), href: '/app/admin/organizations' },
        { label: loadFailed ? t('orgDetail.loadFailedTitle') : t('orgDetail.notFoundBreadcrumb') },
      ]}
    >
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">
          {loadFailed ? t('orgDetail.loadFailedDescription') : t('orgDetail.notFoundDescription')}
        </p>
        <div className="mt-4 flex gap-2">
          {loadFailed && (
            <Button onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('orgDetail.tryAgain')}
            </Button>
          )}
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('orgDetail.backToOrganizations')}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
