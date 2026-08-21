import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DashboardCourseCard } from '@/hooks/useLearnerDashboard';

const ACCENTS = ['bg-legacy-dash-a1', 'bg-legacy-dash-a2', 'bg-legacy-dash-a3'] as const;
const BAR_ACCENTS = ['bg-legacy-dash-a1', 'bg-legacy-dash-a2', 'bg-legacy-dash-a3'] as const;

interface HeroCourseCardProps {
  course: DashboardCourseCard;
  index: number;
  showProgress?: boolean;
  onClick: () => void;
}

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
        'group relative flex min-h-[190px] w-full flex-col overflow-hidden rounded-[18px] text-left',
        'shadow-[0_10px_26px_rgba(9,12,32,0.16)] transition-shadow focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-legacy-dash-ink',
        hasArt ? 'bg-[#fbf9f4] text-white' : cn(accent, 'text-legacy-dash-ink'),
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

      <span className="relative z-[1] flex flex-1 flex-col px-[15px] pb-[13px] pt-[14px]">
        <span className="mb-auto text-[11.5px] font-bold tabular-nums opacity-70">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="line-clamp-3 text-[15px] font-extrabold leading-[1.2] tracking-[-0.02em]">
          {course.title}
        </span>
        <span className="mb-[7px] mt-2 text-[11px] font-semibold tabular-nums opacity-[0.72]">
          {showProgress
            ? t('dashboard.hero.lessonsAndPct', { lessons: course.lessonsTotal, pct: course.pct })
            : t('dashboard.hero.lessonsOnly', { lessons: course.lessonsTotal })}
        </span>
        {showProgress && (
          <span
            className={cn(
              'block h-1 overflow-hidden rounded-full',
              hasArt ? 'bg-white/[0.28]' : 'bg-legacy-dash-ink/[0.18]',
            )}
          >
            <span
              className={cn('block h-full rounded-full', hasArt ? BAR_ACCENTS[index % BAR_ACCENTS.length] : 'bg-legacy-dash-ink')}
              style={{ width: `${course.pct}%` }}
            />
          </span>
        )}
      </span>
    </button>
  );
}
