import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TrendingUp } from 'lucide-react';
import type { EnhancedIdea } from '@/lib/community-types';
import { PRIORITIZABLE_STATUSES } from '@/lib/idea-priority';
import { IdeaScoreDialog } from './IdeaScoreDialog';

interface PrioritizationMatrixProps {
  ideas: EnhancedIdea[];
  onScore: (ideaId: string, value: number | null, effort: number | null) => void;
  isScoring?: boolean;
}

const VALUE_ROWS = [3, 2, 1] as const;   // top → bottom: High, Med, Low
const EFFORT_COLS = [1, 2, 3] as const;  // left → right: Low, Med, High

// Green (good: high value / low effort) → red (bad). Sum-based tint.
function cellTint(value: number, effort: number): string {
  const goodness = value - effort; // -2 .. +2
  if (goodness >= 2) return 'bg-success/10';
  if (goodness === 1) return 'bg-success/[0.06]';
  if (goodness === 0) return 'bg-warning/[0.06]';
  if (goodness === -1) return 'bg-[#c43d3d]/[0.06]';
  return 'bg-[#c43d3d]/10';
}

export function PrioritizationMatrix({ ideas, onScore, isScoring }: PrioritizationMatrixProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dialogIdea, setDialogIdea] = useState<EnhancedIdea | null>(null);

  const inScope = useMemo(
    () => ideas.filter((i) => PRIORITIZABLE_STATUSES.includes(i.status)),
    [ideas],
  );
  const unscored = inScope.filter((i) => i.value_score == null || i.effort_score == null);
  const scoredAt = (v: number, e: number) =>
    inScope.filter((i) => i.value_score === v && i.effort_score === e);

  const drop = (value: number | null, effort: number | null) => {
    if (draggedId) onScore(draggedId, value, effort);
    setDraggedId(null);
  };

  const card = (idea: EnhancedIdea) => (
    <div
      key={idea.id}
      draggable
      onDragStart={() => setDraggedId(idea.id)}
      onDragEnd={() => setDraggedId(null)}
      onClick={() => setDialogIdea(idea)}
      className={cn(
        'cursor-grab rounded-lg border border-[#e4e6ee] bg-card px-2.5 py-2 text-[12px] font-bold leading-tight',
        'transition-shadow hover:shadow-[0_6px_16px_rgba(20,24,46,0.10)]',
        draggedId === idea.id && 'opacity-40',
      )}
    >
      <p className="line-clamp-2">{idea.title}</p>
      <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
        <TrendingUp className="h-[10px] w-[10px]" />
        {idea.vote_count || 0}
      </span>
    </div>
  );

  if (inScope.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d6d8e0] p-8 text-center text-sm text-muted-foreground">
        {t('ideaManagement.prioritize.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Unscored tray */}
      <div
        data-testid="unscored-tray"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => drop(null, null)}
        className="rounded-2xl bg-[#eceef3] p-3"
      >
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[12.5px] font-extrabold tracking-[0.02em]">
            {t('ideaManagement.prioritize.unscored')}
          </span>
          <span className="ml-auto rounded-[7px] bg-card px-[9px] py-0.5 text-[11px] font-extrabold text-muted-foreground">
            {unscored.length}
          </span>
        </div>
        {unscored.length === 0 ? (
          <p className="px-1 pb-1 text-xs text-muted-foreground">{t('ideaManagement.prioritize.unscoredHint')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">{unscored.map(card)}</div>
        )}
      </div>

      {/* 3x3 grid with axis labels */}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        {/* Value axis label (vertical) */}
        <div className="flex items-center">
          <span className="rotate-180 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
            {t('ideaManagement.prioritize.axisValue')} →
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {VALUE_ROWS.map((v) =>
            EFFORT_COLS.map((e) => (
              <div
                key={`${v}-${e}`}
                data-testid={`cell-${v}-${e}`}
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={() => drop(v, e)}
                className={cn('min-h-[110px] rounded-xl p-2', cellTint(v, e))}
              >
                <div className="flex flex-col gap-1.5">{scoredAt(v, e).map(card)}</div>
              </div>
            )),
          )}
          {/* Effort axis label (horizontal), spanning the 3 columns */}
          <div className="col-span-3 pt-1 text-center text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
            {t('ideaManagement.prioritize.axisEffort')} →
          </div>
        </div>
      </div>

      <IdeaScoreDialog
        open={dialogIdea != null}
        onOpenChange={(o) => !o && setDialogIdea(null)}
        ideaTitle={dialogIdea?.title}
        value={dialogIdea?.value_score ?? null}
        effort={dialogIdea?.effort_score ?? null}
        isPending={isScoring}
        onSave={(value, effort) => {
          if (dialogIdea) onScore(dialogIdea.id, value, effort);
          setDialogIdea(null);
        }}
        onClear={() => {
          if (dialogIdea) onScore(dialogIdea.id, null, null);
          setDialogIdea(null);
        }}
      />
    </div>
  );
}
