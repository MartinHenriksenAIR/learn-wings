import { useTranslation, Trans } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { HeroCourseCard } from './HeroCourseCard';
import type { DashboardCourseCard, DashboardLevel } from '@/hooks/useLearnerDashboard';

interface DashboardHeroProps {
  name: string | null;
  initials: string;
  level: DashboardLevel;
  lessonsThisWeek: number;
  overallPct: number;
  courses: DashboardCourseCard[];
  /** True when the learner has never started a course: the headline asks instead of counting. */
  isFresh: boolean;
  /** True when `courses` are catalogue suggestions, not the learner's own in-flight work. */
  coursesAreRecommendations: boolean;
  onCta: () => void;
  onCourseClick: (courseId: string) => void;
}

/**
 * The dark slab that anchors the page: the greeting with a level-ringed avatar,
 * a sentence stating what the learner did lately, the primary call to action,
 * overall progress — and the course tiles sitting flush inside it on the right.
 *
 * The headline says "this week" but the number behind it is a rolling seven-day
 * window (#455) — the copy is the design's, kept short so it lands on two lines
 * inside `max-w-[17ch]`; a third line makes the left column outgrow the tiles.
 *
 * A brand-new learner gets the same slab rather than a wall of zeros: the
 * headline asks instead of counting, the progress bar is dropped, and the tiles
 * become recommendations under their own label.
 */
export function DashboardHero({
  name,
  initials,
  level,
  lessonsThisWeek,
  overallPct,
  courses,
  isFresh,
  coursesAreRecommendations,
  onCta,
  onCourseClick,
}: DashboardHeroProps) {
  const { t } = useTranslation();

  const cards = courses.length > 0 && (
    <div
      data-testid="hero-courses"
      className="grid shrink-0 grid-cols-1 gap-3.5 sm:grid-cols-3 lg:flex lg:[&>*]:w-[176px]"
    >
      {courses.map((course, i) => (
        <HeroCourseCard
          key={course.courseId}
          course={course}
          index={i}
          showProgress={!coursesAreRecommendations}
          onClick={() => onCourseClick(course.courseId)}
        />
      ))}
    </div>
  );

  return (
    <section
      data-testid="dashboard-hero"
      className="mb-[30px] flex flex-col items-stretch gap-6 rounded-[26px] bg-dash-ink p-[30px] text-white lg:flex-row lg:items-center"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-3.5 flex items-center gap-3">
          <span
            className="relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full p-[3px]"
            style={{
              background: `conic-gradient(#a7e8c4 ${isFresh ? 0 : level.progressPct}%, rgba(255,255,255,0.22) 0)`,
            }}
          >
            <span className="grid h-full w-full place-items-center rounded-full bg-white text-sm font-extrabold tracking-[-0.02em] text-dash-ink">
              {initials}
            </span>
            <span
              aria-label={t('dashboard.level.label', { level: level.level })}
              className="absolute -bottom-1 -right-1 grid h-[21px] min-w-[21px] place-items-center rounded-full border-[2.5px] border-dash-ink bg-dash-a3 px-[5px] text-[10.5px] font-extrabold leading-none text-dash-ink"
            >
              {level.level}
            </span>
          </span>
          <span className="text-[17.5px] font-semibold opacity-[0.78]">
            {name ? (
              <Trans i18nKey="dashboard.hero.greeting" values={{ name }} components={{ b: <b className="font-extrabold opacity-100" /> }} />
            ) : (
              t('dashboard.welcome')
            )}
          </span>
        </div>

        <h1 className="mb-5 max-w-[17ch] font-display text-[27px] font-extrabold leading-[1.12] tracking-[-0.03em] sm:text-[34px]">
          {isFresh ? (
            <Trans i18nKey="dashboard.hero.headlineFresh" components={{ em: <em className="not-italic text-dash-a3" /> }} />
          ) : (
            <Trans
              i18nKey="dashboard.hero.headline"
              count={lessonsThisWeek}
              values={{ count: lessonsThisWeek }}
              components={{ em: <em className="not-italic text-dash-a3" /> }}
            />
          )}
        </h1>

        <button
          type="button"
          onClick={onCta}
          className="inline-flex items-center gap-[9px] rounded-full bg-white px-5 py-3 text-[12.5px] font-extrabold uppercase tracking-[0.06em] text-dash-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-dash-ink"
        >
          {isFresh ? t('dashboard.hero.ctaFresh') : t('dashboard.hero.cta')}
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </button>

        {!isFresh && (
          <div className="mt-[18px] max-w-[320px]">
            <div className="mb-[7px] flex items-baseline justify-between text-[12.5px] font-semibold opacity-[0.72]">
              <span>{t('dashboard.overallProgress')}</span>
              <b className="text-[13.5px] font-extrabold tabular-nums opacity-100">{overallPct}%</b>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
              <span className="block h-full rounded-full bg-dash-a3" style={{ width: `${overallPct}%` }} />
            </div>
          </div>
        )}
      </div>

      {coursesAreRecommendations && courses.length > 0 ? (
        <div className="shrink-0">
          <span className="mb-[11px] block text-[11.5px] font-extrabold uppercase tracking-[0.08em] opacity-60">
            {t('dashboard.hero.lovedLabel')}
          </span>
          {cards}
        </div>
      ) : (
        cards
      )}
    </section>
  );
}
