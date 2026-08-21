import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getBand, type PriorityBand } from '@/lib/idea-priority';

const BAND_STYLES: Record<PriorityBand, string> = {
  quick_win: 'bg-legacy-success/15 text-legacy-success',
  big_bet: 'bg-legacy-primary/15 text-legacy-primary',
  fill_in: 'bg-legacy-warning/15 text-legacy-warning',
  deprioritize: 'bg-legacy-muted text-legacy-muted-foreground',
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
