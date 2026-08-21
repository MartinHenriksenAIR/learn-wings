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
  isFresh: boolean;
  coursesAreRecommendations: boolean;
  onCta: () => void;
  onCourseClick: (courseId: string) => void;
}

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
      className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3 lg:flex lg:[&>*]:w-[160px]"
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
      className="mb-[30px] flex flex-col items-stretch gap-8 rounded-[26px] bg-legacy-dash-ink p-[34px] text-white lg:flex-row lg:items-center"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-3">
          <span
            className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full p-[3px]"
            style={{
              background: `conic-gradient(#a7e8c4 ${isFresh ? 0 : level.progressPct}%, rgba(255,255,255,0.22) 0)`,
            }}
          >
            <span className="grid h-full w-full place-items-center rounded-full bg-white text-[13px] font-extrabold tracking-[-0.02em] text-legacy-dash-ink">
              {initials}
            </span>
            <span
              aria-label={t('dashboard.level.label', { level: level.level })}
              className="absolute -bottom-1 -right-1 grid h-[19px] min-w-[19px] place-items-center rounded-full border-[2.5px] border-legacy-dash-ink bg-legacy-dash-a3 px-[5px] text-[10px] font-extrabold leading-none text-legacy-dash-ink"
            >
              {level.level}
            </span>
          </span>
          <span className="text-[16.5px] font-semibold opacity-[0.78]">
            {name ? (
              <Trans i18nKey="dashboard.hero.greeting" values={{ name }} components={{ b: <b className="font-extrabold opacity-100" /> }} />
            ) : (
              t('dashboard.welcome')
            )}
          </span>
        </div>

        <h1 className="mb-[18px] max-w-[17ch] font-display text-[25px] font-extrabold leading-[1.12] tracking-[-0.03em] sm:text-[30px]">
          {isFresh ? (
            <Trans i18nKey="dashboard.hero.headlineFresh" components={{ em: <em className="not-italic text-legacy-dash-a3" /> }} />
          ) : (
            <Trans
              i18nKey="dashboard.hero.headline"
              count={lessonsThisWeek}
              values={{ count: lessonsThisWeek }}
              components={{ em: <em className="not-italic text-legacy-dash-a3" /> }}
            />
          )}
        </h1>

        <button
          type="button"
          onClick={onCta}
          className="inline-flex items-center gap-2 rounded-full bg-white px-[18px] py-[11px] text-[12px] font-extrabold uppercase tracking-[0.06em] text-legacy-dash-ink transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-legacy-dash-ink"
        >
          {isFresh ? t('dashboard.hero.ctaFresh') : t('dashboard.hero.cta')}
          <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
        </button>

        {!isFresh && (
          <div className="mt-4 max-w-[290px]">
            <div className="mb-1.5 flex items-baseline justify-between text-[12px] font-semibold opacity-[0.72]">
              <span>{t('dashboard.overallProgress')}</span>
              <b className="text-[13px] font-extrabold tabular-nums opacity-100">{overallPct}%</b>
            </div>
            <div className="h-[5px] overflow-hidden rounded-full bg-white/20">
              <span className="block h-full rounded-full bg-legacy-dash-a3" style={{ width: `${overallPct}%` }} />
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
