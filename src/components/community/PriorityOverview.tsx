import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { EnhancedIdea } from '@/lib/community-types';
import { BUSINESS_AREAS } from '@/lib/community-types';
import { getBand, rankIdeas, PRIORITIZABLE_STATUSES, type PriorityBand } from '@/lib/idea-priority';
import { PriorityBadge } from './PriorityBadge';

interface PriorityOverviewProps {
  ideas: EnhancedIdea[];
}

const BANDS: PriorityBand[] = ['quick_win', 'big_bet', 'fill_in', 'deprioritize'];

export function PriorityOverview({ ideas }: PriorityOverviewProps) {
  const { t } = useTranslation();

  const inScope = useMemo(
    () => ideas.filter((i) => PRIORITIZABLE_STATUSES.includes(i.status)),
    [ideas],
  );

  const bandCounts = useMemo(() => {
    const counts: Record<PriorityBand, number> = { quick_win: 0, big_bet: 0, fill_in: 0, deprioritize: 0 };
    for (const i of inScope) {
      const band = getBand(i.value_score, i.effort_score);
      if (band) counts[band] += 1;
    }
    return counts;
  }, [inScope]);

  const ranked = useMemo(() => rankIdeas(inScope), [inScope]);

  const areaCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of inScope) {
      if (!i.business_area) continue;
      map.set(i.business_area, (map.get(i.business_area) ?? 0) + 1);
    }
    return BUSINESS_AREAS
      .map((a) => ({ ...a, count: map.get(a.value) ?? 0 }))
      .filter((a) => a.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [inScope]);

  if (inScope.length === 0) return null;

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Quadrant summary */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <div className="grid grid-cols-2 gap-2">
          {BANDS.map((band) => (
            <div key={band} className="rounded-xl bg-[#f3f4f8] p-3">
              <div data-testid={`band-count-${band}`} className="text-[22px] font-extrabold leading-none">{bandCounts[band]}</div>
              <div className="mt-1 text-[11.5px] font-bold text-muted-foreground">
                {t(`ideaManagement.bands.${band}`)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Do next */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <h3 className="mb-3 text-[13px] font-extrabold tracking-[0.02em]">
          {t('ideaManagement.prioritize.doNext')}
        </h3>
        <ol data-testid="do-next-list" className="space-y-2">
          {ranked.map((idea, idx) => (
            <li key={idea.id} className="flex items-center gap-2 text-[13px]">
              <span className="w-4 shrink-0 text-right font-bold text-muted-foreground">{idx + 1}</span>
              <span className="flex-1 truncate font-semibold">{idea.title}</span>
              <PriorityBadge value={idea.value_score} effort={idea.effort_score} />
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted-foreground">
                <TrendingUp className="h-[11px] w-[11px]" />
                {idea.vote_count || 0}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* By business area */}
      <div className="rounded-2xl border border-[#e4e6ee] bg-card p-4">
        <h3 className="mb-3 text-[13px] font-extrabold tracking-[0.02em]">
          {t('ideaManagement.prioritize.byBusinessArea')}
        </h3>
        <ul data-testid="business-area-list" className="space-y-2">
          {areaCounts.map((a) => (
            <li key={a.value} className="flex items-center justify-between text-[13px]">
              <span className="font-semibold">{a.label}</span>
              <span className="text-muted-foreground">{t('ideaManagement.prioritize.count', { count: a.count })}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
