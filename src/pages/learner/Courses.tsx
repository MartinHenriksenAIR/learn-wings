import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LevelBadge } from '@/components/ui/level-badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useFavorites, useToggleFavorite } from '@/hooks/useFavorites';
import { FavoriteToggle } from '@/components/learner/FavoriteToggle';
import { Course, Enrollment } from '@/lib/types';
import { BookOpen, CheckCircle2, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Module-level stable empty fallbacks so the `?? …` reads keep a referentially
// stable value across renders (avoids re-running the filter/sort useMemo every render).
const NO_COURSES: Course[] = [];
const NO_ENROLLMENTS: Enrollment[] = [];

export default function LearnerCourses() {
  const { currentOrg, profile, isPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Solo learners render as normal learners against a hidden placeholder org — the
  // catalogue chrome must stay org-name-free for them (never surface the placeholder).
  const isIndividual = currentOrg?.kind === 'individual';

  const query = useLearnerCourses(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const { isFavorite } = useFavorites(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });
  const { toggleFavorite, togglingId } = useToggleFavorite(currentOrg?.id);

  const courses = query.data?.courses ?? NO_COURSES;
  const enrollments = query.data?.enrollments ?? NO_ENROLLMENTS;
  const progressData: Record<string, { total: number; completed: number }> = query.data?.progress ?? {};

  const getEnrollmentStatus = (courseId: string) => {
    return enrollments.find(e => e.course_id === courseId);
  };

  const clearFilters = () => {
    setSearch('');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const hasActiveFilters = search.trim() !== '' || levelFilter !== 'all' || statusFilter !== 'all';

  // Level-matched recommendations (#117) — drives both the recommended grid and the
  // "All courses" heading that separates it from the full catalog below.
  const recommendedCourses = profile?.assessment_level != null
    ? courses.filter(c => c.level === profile.assessment_level)
    : [];

  // Filter, then order started courses first (#338). A course is "started" once it has
  // an enrollment — now created implicitly on first open (#357) rather than by a manual
  // enroll step. Started courses (status `enrolled` OR `completed`) sort above not-started
  // ones; within the started group by recent activity — `last_accessed_at` DESC, falling
  // back to `enrolled_at` when a course has no activity yet (#339). Array.prototype.sort is
  // stable (ES2019), so returning 0 for two not-started courses preserves the backend's
  // alphabetical (ORDER BY c.title) order. `.filter` returns a fresh array, so sorting it
  // does not mutate `courses`.
  const filteredCourses = useMemo(() => {
    const matches = courses.filter(course => {
      const matchesSearch = search === '' ||
        course.title.toLowerCase().includes(search.toLowerCase()) ||
        course.description?.toLowerCase().includes(search.toLowerCase());

      const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

      const enrollment = enrollments.find(e => e.course_id === course.id);
      let matchesStatus = true;
      if (statusFilter === 'in_progress') {
        matchesStatus = !!enrollment && enrollment.status !== 'completed';
      } else if (statusFilter === 'completed') {
        matchesStatus = enrollment?.status === 'completed';
      } else if (statusFilter === 'not_started') {
        matchesStatus = !enrollment;
      }

      return matchesSearch && matchesLevel && matchesStatus;
    });

    return matches.sort((a, b) => {
      const ea = enrollments.find(e => e.course_id === a.id);
      const eb = enrollments.find(e => e.course_id === b.id);
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      if (ea && eb) {
        const ka = new Date(ea.last_accessed_at ?? ea.enrolled_at).getTime();
        const kb = new Date(eb.last_accessed_at ?? eb.enrolled_at).getTime();
        return kb - ka; // DESC — most recent activity first
      }
      return 0;
    });
  }, [courses, enrollments, search, levelFilter, statusFilter]);

  if (orgGuard === 'loading' || query.isLoading) {
    return (
      <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    // A non-admin with no org here is a blocked walk-in (individual tier off, or the
    // placeholder org is missing) — registration is invitation-only, so show that
    // instead of "join an org". Platform admins land here via the no-org-selected edge.
    return (
      <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">
            {isPlatformAdmin ? t('common.noOrgSelected') : t('dashboard.invitationOnlyTitle')}
          </p>
          <p className="text-sm text-muted-foreground">
            {isPlatformAdmin ? t('courses.joinOrgToAccessCourses') : t('dashboard.invitationOnlyDescription')}
          </p>
        </div>
      </AppLayout>
    );
  }

  // A failed catalogue fetch must not render the "no courses available" empty
  // state — show a distinct, retryable error fork instead.
  if (query.isError) {
    return (
      <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => query.refetch()} />
        </div>
      </AppLayout>
    );
  }

  const selectClasses =
    'cursor-pointer rounded-xl border border-input bg-card py-[11px] pl-[13px] text-[13px] font-semibold text-[#2a2d3a] outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(16,41,143,0.10)]';

  /** Renders a single course card. `showChip` adds the "Recommended" chip top-right. */
  const renderCourseCard = (course: Course, showChip: boolean) => {
    const enrollment = getEnrollmentStatus(course.id);
    const isCompleted = enrollment?.status === 'completed';

    // Lesson progress for the started-card bar. Completed courses read 100%;
    // otherwise guard divide-by-zero when the course has no lessons yet.
    const total = progressData[course.id]?.total ?? 0;
    const completed = progressData[course.id]?.completed ?? 0;
    const percent = isCompleted ? 100 : total === 0 ? 0 : Math.round((completed / total) * 100);

    // One CTA in every state — opening the course starts it (enrollment is implicit,
    // #357), so the button is always a link to the player. Its label reflects state:
    // review a finished course, continue a started one, start a not-yet-opened one.
    const ctaLabel = isCompleted
      ? t('courses.reviewCourse')
      : enrollment
        ? t('common.continue')
        : t('courses.startCourse');

    return (
      <div
        key={course.id}
        className="hover-lift flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
      >
        {/* Thumbnail with status badge */}
        <div className="relative h-[118px] bg-gradient-to-br from-primary/80 to-primary">
          {course.thumbnail_url && (
            <img
              src={course.thumbnail_url}
              alt={course.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {showChip && (
            <span
              data-testid="recommended-chip"
              className="absolute right-3 top-3 inline-flex items-center rounded-[7px] bg-primary px-[11px] py-[5px] text-[11px] font-bold text-primary-foreground"
            >
              {t('assessment.recommendations.chip')}
            </span>
          )}
          {isCompleted && (
            <span
              data-testid="status-badge-completed"
              className={`absolute ${showChip ? 'left-3' : 'right-3'} top-3 inline-flex items-center gap-[5px] rounded-[7px] bg-success px-[11px] py-[5px] text-[11px] font-bold text-success-foreground`}
            >
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
              {t('dashboard.completed')}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-[9px] px-[18px] pb-[18px] pt-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14.5px] font-bold leading-[1.35]">{course.title}</h3>
            <div className="flex shrink-0 items-center gap-1">
              <LevelBadge level={course.level} />
              <FavoriteToggle
                isFavorite={isFavorite(course.id)}
                pending={togglingId === course.id}
                onToggle={(next) => toggleFavorite({ courseId: course.id, favorite: next, course })}
                className="-my-1 -mr-1.5 h-7 w-7"
              />
            </div>
          </div>
          <p className="line-clamp-2 text-[12.5px] leading-normal text-muted-foreground">
            {course.description}
          </p>

          <div className="mt-auto flex flex-col gap-2.5">
            {enrollment && (
              // Progress bar + % on started cards — same markup/classes as the
              // dashboard's "Continue Learning" bar for visual consistency (#340).
              <div data-testid={`course-progress-${course.id}`} className="flex items-center gap-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eceef3]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
                <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">{percent}%</span>
              </div>
            )}
            <Button
              asChild
              className={cn(
                'h-auto w-full rounded-[10px] px-3 py-[9px] text-[13px] font-bold',
                isCompleted
                  ? 'border border-[#cfd6ef] bg-card text-primary hover:bg-accent'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              <Link to={routes.learner.coursePlayer(course.id)}>
                <Play aria-hidden="true" />
                {ctaLabel}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
      <div className="mb-[22px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('courses.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {isIndividual ? t('courses.subtitleIndividual') : t('courses.subtitle', { orgName: currentOrg.name })}
        </p>
      </div>

      <div className="mb-[22px] flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('courses.searchPlaceholder')}
            className="h-auto rounded-xl bg-card py-[11px] pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label={t('courses.level')}
          className={selectClasses}
        >
          <option value="all">{t('courses.allLevels')}</option>
          <option value="basic">{t('courses.levels.basic')}</option>
          <option value="intermediate">{t('courses.levels.intermediate')}</option>
          <option value="advanced">{t('courses.levels.advanced')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label={t('courses.status')}
          className={selectClasses}
        >
          <option value="all">{t('courses.anyStatus')}</option>
          <option value="in_progress">{t('courses.statusOptions.inProgress')}</option>
          <option value="completed">{t('courses.statusOptions.completed')}</option>
          <option value="not_started">{t('courses.statusOptions.notStarted')}</option>
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] font-semibold text-muted-foreground hover:text-primary"
          >
            {t('common.clear')}
          </button>
        )}
      </div>

      {/* Recommended section — only shown when the learner has a known assessment level */}
      {profile?.assessment_level != null && recommendedCourses.length > 0 && (
        <div className="mb-8" data-testid="recommended-section">
          <div className="mb-3.5 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[17px] font-bold">{t('assessment.recommendations.forYou')}</h2>
            <LevelBadge level={profile.assessment_level} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recommendedCourses.map((course) => renderCourseCard(course, true))}
          </div>
        </div>
      )}

      {/* All courses heading — shown when a recommended section is also visible */}
      {recommendedCourses.length > 0 && (
        <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('assessment.recommendations.allCourses')}</h2>
      )}

      {filteredCourses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('courses.noCoursesAvailable')}
          description={
            search
              ? t('courses.noCoursesMatch')
              : t('courses.noCoursesForOrg')
          }
          className="rounded-2xl border-[#d6d8e0] bg-card"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCourses.map((course) => renderCourseCard(course, false))}
        </div>
      )}
    </AppLayout>
  );
}
