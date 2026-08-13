import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DashboardCourseCard } from '@/hooks/useLearnerDashboard';

/** Accent fill per position — the tile's identity, and the fallback when a course has no artwork. */
const ACCENTS = ['bg-dash-a1', 'bg-dash-a2', 'bg-dash-a3'] as const;
const BAR_ACCENTS = ['bg-dash-a1', 'bg-dash-a2', 'bg-dash-a3'] as const;

interface HeroCourseCardProps {
  course: DashboardCourseCard;
  index: number;
  /** Recommendations have no progress yet: lesson count only, no bar. */
  showProgress?: boolean;
  onClick: () => void;
}

/**
 * A course tile in the hero slab. The thumbnail IS the card — nothing sits on
 * the artwork but the gradient that makes the text legible. `thumbnail_url` is
 * nullable, so a card with no artwork falls back to the flat accent fill and
 * has to look deliberate on its own.
 */
export function HeroCourseCard({ course, index, showProgress = true, onClick }: HeroCourseCardProps) {
  const { t } = useTranslation();
  const accent = ACCENTS[index % ACCENTS.length];
  const hasArt = !!course.thumbnailUrl;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="hero-course-card"
      className={cn(
        'group relative flex min-h-[210px] w-full flex-col overflow-hidden rounded-[20px] text-left',
        'shadow-[0_10px_26px_rgba(9,12,32,0.16)] transition-shadow focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dash-ink',
        hasArt ? 'bg-[#fbf9f4] text-white' : cn(accent, 'text-dash-ink'),
      )}
    >
      {hasArt && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-[center_32%] bg-no-repeat transition-transform duration-500 ease-out group-hover:scale-[1.06]"
            style={{ backgroundImage: `url("${course.thumbnailUrl}")`, backgroundSize: 'contain' }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-[rgba(8,10,24,0.08)] via-[rgba(8,10,24,0.42)] to-[rgba(8,10,24,0.86)] transition-opacity duration-300 group-hover:opacity-90"
          />
        </>
      )}

      <span className="relative z-[1] flex flex-1 flex-col px-[17px] pb-[15px] pt-4">
        <span className="mb-auto text-[12.5px] font-bold tabular-nums opacity-70">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="line-clamp-3 text-base font-extrabold leading-[1.2] tracking-[-0.02em]">
          {course.title}
        </span>
        <span className="mb-2 mt-[9px] text-[11.5px] font-semibold tabular-nums opacity-[0.72]">
          {showProgress
            ? t('dashboard.hero.lessonsAndPct', { lessons: course.lessonsTotal, pct: course.pct })
            : t('dashboard.hero.lessonsOnly', { lessons: course.lessonsTotal })}
        </span>
        {showProgress && (
          <span
            className={cn(
              'block h-1 overflow-hidden rounded-full',
              hasArt ? 'bg-white/[0.28]' : 'bg-dash-ink/[0.18]',
            )}
          >
            <span
              className={cn('block h-full rounded-full', hasArt ? BAR_ACCENTS[index % BAR_ACCENTS.length] : 'bg-dash-ink')}
              style={{ width: `${course.pct}%` }}
            />
          </span>
        )}
      </span>
    </button>
  );
}
