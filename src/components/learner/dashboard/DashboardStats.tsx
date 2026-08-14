import { useTranslation } from 'react-i18next';
import { Sparkline } from './Sparkline';
import type { DashboardSnapshot, WeekActivity } from '@/hooks/useLearnerDashboard';

const CARD = 'rounded-[20px] bg-card shadow-[0_2px_5px_rgba(17,20,45,0.045)]';

function Counter({ value, label }: { value: number; label: string }) {
  return (
    <div className={`${CARD} min-w-0 px-[22px] py-5`}>
      <div className="mb-2 text-[32px] font-extrabold leading-none tracking-[-0.035em] tabular-nums sm:text-[38px]">
        {value}
      </div>
      <div className="text-[12.5px] font-semibold leading-[1.35] text-muted-foreground">{label}</div>
    </div>
  );
}

function formatHours(minutes: number, language: string): string {
  const hours = minutes / 60;
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(hours);
}

interface DashboardStatsProps {
  snapshot: DashboardSnapshot;
  week: WeekActivity;
}

export function DashboardStats({ snapshot, week }: DashboardStatsProps) {
  const { t, i18n } = useTranslation();

  const { minutes, previous, untimedLessons, perDayMinutes } = week;
  const deltaPct =
    previous.minutes > 0 ? Math.round(((minutes - previous.minutes) / previous.minutes) * 100) : null;

  return (
    <div data-testid="dashboard-snapshot" className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-[0.8fr_0.8fr_2.4fr]">
      <Counter value={snapshot.inProgress} label={t('dashboard.stats.coursesInProgress')} />
      <Counter value={snapshot.completed} label={t('dashboard.stats.coursesCompleted')} />

      <div className={`${CARD} flex min-w-0 items-center gap-3.5 overflow-hidden px-[22px] py-5 md:col-span-2 lg:col-span-1`}>
        <div className="min-w-0 shrink">
          <div className="mb-2 text-[32px] font-extrabold leading-none tracking-[-0.035em] tabular-nums sm:text-[38px]">
            {formatHours(minutes, i18n.language)}
            <small className="ml-1 text-[17px] font-bold tracking-[-0.01em] opacity-45">
              {t('dashboard.stats.hoursUnit')}
            </small>
          </div>
          <div className="text-[12.5px] font-semibold leading-[1.35] text-muted-foreground">
            {t('dashboard.stats.learningTime')}
          </div>
          {deltaPct !== null && (
            <div className="mt-[7px] whitespace-nowrap text-xs font-semibold text-muted-foreground">
              <span className="font-extrabold text-foreground">
                {deltaPct > 0 ? '+' : ''}
                {deltaPct}%
              </span>{' '}
              {t('dashboard.stats.vsPrevious')}
            </div>
          )}
          {untimedLessons > 0 && (
            <div className="mt-1 text-[11px] font-medium text-muted-foreground">
              {t('dashboard.stats.untimed', { count: untimedLessons })}
            </div>
          )}
        </div>
        <div className="-my-5 -mr-[22px] flex min-w-[110px] flex-[1_1_0] self-stretch items-end [mask-image:linear-gradient(90deg,transparent_0%,rgba(0,0,0,0.35)_14%,#000_34%)]">
          <Sparkline values={perDayMinutes} />
        </div>
      </div>
    </div>
  );
}
