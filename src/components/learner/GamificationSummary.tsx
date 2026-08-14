import { useTranslation } from 'react-i18next';
import { Zap, Flame } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { DashboardLevel } from '@/hooks/useLearnerDashboard';

interface GamificationSummaryProps {
  xp: { allTime: number; month: number };
  level: DashboardLevel;
  streak: { current: number; activeToday: boolean };
}

export function GamificationSummary({ xp, level, streak }: GamificationSummaryProps) {
  const { t } = useTranslation();

  const streakLine = streak.activeToday
    ? t('dashboard.streak.activeToday')
    : streak.current > 0
      ? t('dashboard.streak.keepItUp')
      : t('dashboard.streak.none');

  return (
    <div className="mb-7 grid gap-3.5 sm:grid-cols-2">
      <div className="rounded-2xl border border-border bg-card px-5 py-[18px]">
        <div className="mb-3 flex items-center gap-3.5">
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-accent text-primary">
            <Zap className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="text-[22px] font-extrabold tracking-[-0.02em]">
              {t('dashboard.level.label', { level: level.level })}
            </span>
            <span className="text-[12.5px] font-medium text-muted-foreground">
              {t('dashboard.xp.total', { xp: String(xp.allTime) })}
            </span>
          </span>
        </div>
        <Progress value={level.progressPct} className="h-1.5" />
        <p className="mt-2 text-[12.5px] font-medium text-muted-foreground">
          {t('dashboard.level.toNext', { xp: String(level.xpToNext), level: level.level + 1 })}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card px-5 py-[18px]">
        <div className="flex items-center gap-3.5">
          <span
            className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl ${
              streak.activeToday ? 'bg-[#fff1e6] text-[#f97316]' : 'bg-accent text-muted-foreground'
            }`}
          >
            <Flame className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="text-[22px] font-extrabold tracking-[-0.02em]">
              {t('dashboard.streak.days', { count: streak.current })}
            </span>
            <span className="text-[12.5px] font-medium text-muted-foreground">{streakLine}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
