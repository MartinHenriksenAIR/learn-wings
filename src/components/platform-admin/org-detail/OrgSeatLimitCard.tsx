import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SeatUsageBar } from '@/components/platform-admin/SeatUsageBar';

interface OrgSeatLimitCardProps {
  usedCount: number;
  seatLimit: number;
}

export function OrgSeatLimitCard({ usedCount, seatLimit }: OrgSeatLimitCardProps) {
  const { t } = useTranslation();
  const seatLimitReached = usedCount >= seatLimit;

  return (
    <div className="mb-6 rounded-legacy-2xl border border-legacy-border bg-legacy-card px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-bold text-[#4a4f60]">{t('orgDetail.seatLimit')}</span>
        <span className={cn('text-[12.5px] font-bold', seatLimitReached ? 'text-legacy-destructive' : 'text-legacy-muted-foreground')}>
          {usedCount}/{seatLimit}
        </span>
      </div>
      <SeatUsageBar
        used={usedCount}
        limit={seatLimit}
        className="mt-2 h-[6px]"
      />
      {seatLimitReached && (
        <p className="mt-2 text-xs font-medium text-legacy-destructive">{t('orgDetail.seatLimitReached')}</p>
      )}
    </div>
  );
}
