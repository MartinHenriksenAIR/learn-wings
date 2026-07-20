import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { SeatUsage } from '@/lib/seats';

/**
 * One-line "X of Y seats used · Z remaining" summary for the invite dialogs.
 * Renders "Unlimited seats" (no remaining number) when the org has no limit.
 */
export function SeatUsageNote({ usage, className }: { usage: SeatUsage; className?: string }) {
  const { t } = useTranslation();

  return (
    <p className={cn('text-xs font-medium text-muted-foreground', className)}>
      {usage.isUnlimited
        ? t('seats.unlimited')
        : t('seats.usage', {
            used: usage.usedSeats,
            limit: usage.seatLimit,
            remaining: usage.remaining,
          })}
    </p>
  );
}
