import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBand, type PriorityBand } from '@/lib/idea-priority';

const BAND_STYLES: Record<PriorityBand, string> = {
  quick_win: 'bg-success/15 text-success',
  big_bet: 'bg-primary/15 text-primary',
  fill_in: 'bg-warning/15 text-warning',
  deprioritize: 'bg-muted text-muted-foreground',
};

interface Props {
  value: number | null;
  effort: number | null;
  className?: string;
}

export function PriorityBadge({ value, effort, className }: Props) {
  const { t } = useTranslation();
  const band = getBand(value, effort);
  if (!band) return null;
  return (
    <span
      className={cn(
        'rounded-[7px] px-[9px] py-[3px] text-[10.5px] font-bold',
        BAND_STYLES[band],
        className,
      )}
    >
      {t(`ideaManagement.bands.${band}`)}
    </span>
  );
}
