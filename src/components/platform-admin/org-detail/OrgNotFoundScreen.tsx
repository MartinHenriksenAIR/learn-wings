import { useTranslation } from 'react-i18next';
import { Building2, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';

interface OrgNotFoundScreenProps {
  loadFailed: boolean;
  onRetry: () => void;
}

export function OrgNotFoundScreen({ loadFailed, onRetry }: OrgNotFoundScreenProps) {
  const { t } = useTranslation();

  return (
    <AppLayout title={loadFailed ? t('orgDetail.loadFailedTitle') : t('orgDetail.notFoundTitle')}>
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Building2 className="h-12 w-12 text-legacy-muted-foreground/50 mb-4" />
        <p className="text-legacy-muted-foreground">
          {loadFailed ? t('orgDetail.loadFailedDescription') : t('orgDetail.notFoundDescription')}
        </p>
        {loadFailed && (
          <div className="mt-4 flex gap-2">
            <Button onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('orgDetail.tryAgain')}
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
