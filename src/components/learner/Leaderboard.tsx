import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeaderboardRow, LeaderboardWindow } from '@/hooks/useLearnerDashboard';

interface LeaderboardProps {
  leaderboard: { allTime: LeaderboardWindow; month: LeaderboardWindow };
}

function Row({ row }: { row: LeaderboardRow }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl px-3.5 py-2.5',
        row.isSelf ? 'bg-accent' : 'bg-transparent',
      )}
    >
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12.5px] font-bold tabular-nums',
          row.rank === 1 ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-muted text-muted-foreground',
        )}
      >
        {row.rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{row.name}</span>
      <span className="shrink-0 text-[13px] font-bold tabular-nums text-primary">{row.xp} XP</span>
    </div>
  );
}

export function Leaderboard({ leaderboard }: LeaderboardProps) {
  const { t } = useTranslation();
  const [window, setWindow] = useState<'allTime' | 'month'>('allTime');

  const active = leaderboard[window];
  const meInRows = active.me != null && active.rows.some((r) => r.isSelf);

  const tab = (key: 'allTime' | 'month', label: string) => (
    <button
      type="button"
      onClick={() => setWindow(key)}
      aria-pressed={window === key}
      className={cn(
        'rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors',
        window === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="mb-8" data-testid="dashboard-leaderboard">
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 font-display text-[17px] font-bold">
          <Trophy className="h-[18px] w-[18px] text-primary" aria-hidden="true" />
          {t('dashboard.leaderboard.title')}
        </h2>
        <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1">
          {tab('allTime', t('dashboard.leaderboard.allTime'))}
          {tab('month', t('dashboard.leaderboard.thisMonth'))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-2.5">
        {active.rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {t('dashboard.leaderboard.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {active.rows.map((row) => (
              <Row key={`${window}-${row.rank}`} row={row} />
            ))}
            {active.me && !meInRows && (
              <>
                <div className="my-1 border-t border-dashed border-border" />
                <p className="px-3.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {t('dashboard.leaderboard.yourRank')}
                </p>
                <Row row={active.me} />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
