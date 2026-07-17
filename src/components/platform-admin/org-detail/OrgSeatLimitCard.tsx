import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SeatUsageBar } from '@/components/platform-admin/SeatUsageBar';

interface OrgSeatLimitCardProps {
  usedCount: number;
  seatLimit: number;
}

/**
 * The seat-limit usage bar card, shown only when a limit exists. The
 * SEAT_LIMIT_REACHED warning is preserved.
 */
export function OrgSeatLimitCard({ usedCount, seatLimit }: OrgSeatLimitCardProps) {
  const { t } = useTranslation();
  const seatLimitReached = usedCount >= seatLimit;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-bold text-[#4a4f60]">{t('orgDetail.seatLimit')}</span>
        <span className={cn('text-[12.5px] font-bold', seatLimitReached ? 'text-destructive' : 'text-muted-foreground')}>
          {usedCount}/{seatLimit}
        </span>
      </div>
      <SeatUsageBar
        used={usedCount}
        limit={seatLimit}
        className="mt-2 h-[6px]"
      />
      {seatLimitReached && (
        <p className="mt-2 text-xs font-medium text-destructive">{t('orgDetail.seatLimitReached')}</p>
      )}
    </div>
  );
}
