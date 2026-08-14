import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { SectionHeading } from './section';
import type { LeaderboardRow, LeaderboardWindow } from '@/hooks/useLearnerDashboard';

const VISIBLE_ROWS = 4;

const RANK_TILES: Record<number, string> = {
  1: 'bg-dash-a3 text-dash-ink',
  2: 'bg-dash-a1 text-dash-ink',
  3: 'bg-dash-a2 text-dash-ink',
};

function Row({ row, xpLabel }: { row: LeaderboardRow; xpLabel: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[13px] px-2 py-2.5',
        row.isSelf && 'bg-dash-a1 text-dash-ink',
      )}
    >
      <span
        className={cn(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] text-[12.5px] font-extrabold tabular-nums',
          RANK_TILES[row.rank] ?? 'bg-[rgba(23,26,38,0.05)] text-muted-foreground',
          row.isSelf && !RANK_TILES[row.rank] && 'bg-dash-ink/[0.14] text-dash-ink',
        )}
      >
        {row.rank}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{row.name}</span>
      <span className="shrink-0 text-[13px] font-extrabold tabular-nums" aria-label={xpLabel}>
        {row.xp}
      </span>
    </div>
  );
}

export function DashboardLeaderboard({ leaderboard }: { leaderboard: LeaderboardWindow }) {
  const { t } = useTranslation();

  const rows = leaderboard.rows.slice(0, VISIBLE_ROWS);
  const meShown = leaderboard.me != null && rows.some((r) => r.isSelf);

  return (
    <section data-testid="dashboard-leaderboard">
      <SectionHeading>{t('dashboard.leaderboard.title')}</SectionHeading>

      {rows.length === 0 ? (
        <p className="px-2 py-6 text-[13px] text-muted-foreground">{t('dashboard.leaderboard.empty')}</p>
      ) : (
        <>
          {rows.map((row) => (
            <Row key={row.rank} row={row} xpLabel={t('dashboard.leaderboard.xpLabel', { xp: row.xp })} />
          ))}
          {leaderboard.me && !meShown && (
            <>
              <div className="mx-2 my-1.5 border-t border-dashed border-border" />
              <p className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {t('dashboard.leaderboard.yourRank')}
              </p>
              <Row
                row={leaderboard.me}
                xpLabel={t('dashboard.leaderboard.xpLabel', { xp: leaderboard.me.xp })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
