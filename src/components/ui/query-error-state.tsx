import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QueryErrorStateProps {
  onRetry: () => void;
  title?: string;
  description?: string;
  className?: string;
}

export function QueryErrorState({ onRetry, title, description, className }: QueryErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-legacy-2xl border border-legacy-destructive/30 bg-legacy-card p-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-legacy-destructive/10 text-legacy-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-bold">{title ?? t('common.loadErrorTitle')}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-legacy-muted-foreground">
        {description ?? t('common.loadErrorDescription')}
      </p>
      <Button variant="outline" onClick={onRetry} className="mt-4">
        {t('common.retry')}
      </Button>
    </div>
  );
}
