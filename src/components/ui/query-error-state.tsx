import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QueryErrorStateProps {
  /** Retry handler — wire to the failed query's `refetch`. */
  onRetry: () => void;
  /** Override the default title copy ("Something went wrong"). */
  title?: string;
  /** Override the default description copy. */
  description?: string;
  className?: string;
}

/**
 * Full-page error fork for a failed primary query. Visually distinct from the
 * dashed `EmptyState` (a legitimately empty account) so a load failure can't be
 * misread as "no data yet". Defaults to shared `common.loadError*` copy; pass
 * `title`/`description` to specialize per surface.
 */
export function QueryErrorState({ onRetry, title, description, className }: QueryErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-card p-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-[15px] font-bold">{title ?? t('common.loadErrorTitle')}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        {description ?? t('common.loadErrorDescription')}
      </p>
      <Button variant="outline" onClick={onRetry} className="mt-4">
        {t('common.retry')}
      </Button>
    </div>
  );
}
