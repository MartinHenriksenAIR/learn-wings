import { useMemo, useState, type ReactNode } from 'react';
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
import { useCourseCategories } from '@/hooks/useCourseCategories';
import { useFavorites, useToggleFavorite } from '@/hooks/useFavorites';
import { FavoriteToggle } from '@/components/learner/FavoriteToggle';
import { Course, CourseCategory, Enrollment } from '@/lib/types';
import { BookOpen, CheckCircle2, LayoutGrid, List, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// Module-level stable empty fallbacks so the `?? …` reads keep a referentially
// stable value across renders (avoids re-running the filter/sort useMemo every render).
const NO_COURSES: Course[] = [];
const NO_ENROLLMENTS: Enrollment[] = [];
const NO_CATEGORIES: CourseCategory[] = [];

// The learner's list/card preference persists across visits (#360). Card is the default.
const VIEW_STORAGE_KEY = 'kursuskatalog-view';
type CatalogView = 'card' | 'list';

function readStoredView(): CatalogView {
  if (typeof window === 'undefined') return 'card';
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'card';
  } catch {
    return 'card';
  }
}

export default function LearnerCourses() {
  const { currentOrg, profile, isPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useState<CatalogView>(readStoredView);

  const query = useLearnerCourses(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const categoriesQuery = useCourseCategories({
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const { isFavorite } = useFavorites(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });
  const { toggleFavorite, togglingId } = useToggleFavorite(currentOrg?.id);

  const courses = query.data?.courses ?? NO_COURSES;
  const enrollments = query.data?.enrollments ?? NO_ENROLLMENTS;
  const progressData: Record<string, { total: number; completed: number }> = query.data?.progress ?? {};
  const categories = categoriesQuery.data ?? NO_CATEGORIES;

  const isDanish = i18n.language.startsWith('da');
  const categoryName = (category: CourseCategory) => (isDanish ? category.name_da : category.name_en);

  // Only offer categories that actually have a course in this catalogue — a filter option
  // that can only ever yield an empty grid is noise. Keeps the admin-managed order.
  const availableCategories = useMemo(
    () => categories.filter((c) => courses.some((course) => course.category_id === c.id)),
    [categories, courses],
  );

  const selectCatalogView = (next: CatalogView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — the in-memory choice still applies this session */
    }
  };

  const getEnrollmentStatus = (courseId: string) => {
    return enrollments.find(e => e.course_id === courseId);
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const hasActiveFilters =
    search.trim() !== '' || categoryFilter !== 'all' || levelFilter !== 'all' || statusFilter !== 'all';

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

      const matchesCategory = categoryFilter === 'all' || course.category_id === categoryFilter;

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

      return matchesSearch && matchesCategory && matchesLevel && matchesStatus;
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
  }, [courses, enrollments, search, categoryFilter, levelFilter, statusFilter]);

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

  /** State-aware player CTA label — review a finished course, continue a started one, start a fresh one. */
  const ctaLabelFor = (enrollment: Enrollment | undefined, isCompleted: boolean) =>
    isCompleted ? t('courses.reviewCourse') : enrollment ? t('common.continue') : t('courses.startCourse');

  /**
   * The whole card/row opens the course detail page ("read about a course", #360) via a
   * stretched overlay link (z-10). The interactive controls — the Start/CTA button
   * (→ player) and the favorite toggle — carry z-20 so they sit above the overlay and keep
   * their own actions. Static content (title, description, thumbnail) sits under the overlay.
   */
  const detailOverlay = (course: Course) => (
    <Link
      to={routes.learner.courseDetail(course.id)}
      aria-label={t('courses.readAbout', { title: course.title })}
      className="absolute inset-0 z-10 rounded-2xl"
    />
  );

  // State-aware player CTA for a catalog card. It renders directly under the title (in the card
  // body flow), so it carries `relative z-20` to stay clickable above the detail overlay and
  // `self-start` to keep its natural width in the flex column.
  const courseCta = (course: Course, enrollment: Enrollment | undefined, isCompleted: boolean) => (
    <Button
      asChild
      className="relative z-20 h-auto self-start rounded-[9px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground hover:bg-primary/90"
    >
      <Link to={routes.learner.coursePlayer(course.id)}>
        <Play aria-hidden="true" className="h-3.5 w-3.5" />
        {ctaLabelFor(enrollment, isCompleted)}
      </Link>
    </Button>
  );

  const progressBar = (course: Course, percent: number) => (
    <div data-testid={`course-progress-${course.id}`} className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eceef3]">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">{percent}%</span>
    </div>
  );

  /** Percent complete for a started card: completed → 100, else guard divide-by-zero. */
  const percentFor = (course: Course, isCompleted: boolean) => {
    const total = progressData[course.id]?.total ?? 0;
    const completed = progressData[course.id]?.completed ?? 0;
    return isCompleted ? 100 : total === 0 ? 0 : Math.round((completed / total) * 100);
  };

  /** Card layout. `showChip` adds the "Recommended" chip top-right. */
  const renderCourseCard = (course: Course, showChip: boolean) => {
    const enrollment = getEnrollmentStatus(course.id);
    const isCompleted = enrollment?.status === 'completed';
    const percent = percentFor(course, isCompleted);

    return (
      <div
        key={course.id}
        className="hover-lift-lg relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
      >
        {detailOverlay(course)}

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
                className="relative z-20 -my-1 -mr-1.5 h-7 w-7"
              />
            </div>
          </div>
          {courseCta(course, enrollment, isCompleted)}
          <p className="line-clamp-2 text-[12.5px] leading-normal text-muted-foreground">
            {course.description}
          </p>

          {enrollment && <div className="mt-auto">{progressBar(course, percent)}</div>}
        </div>
      </div>
    );
  };

  /** List-row layout — same whole-row-to-detail + Start/favorite controls as the card. */
  const renderCourseRow = (course: Course) => {
    const enrollment = getEnrollmentStatus(course.id);
    const isCompleted = enrollment?.status === 'completed';
    const percent = percentFor(course, isCompleted);

    return (
      <div
        key={course.id}
        className="hover-lift-lg relative flex items-center gap-4 rounded-xl border border-border bg-card p-3"
      >
        {detailOverlay(course)}

        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/80 to-primary">
          {course.thumbnail_url && (
            <img src={course.thumbnail_url} alt={course.title} className="absolute inset-0 h-full w-full object-cover" />
          )}
          {isCompleted && (
            <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded-[6px] bg-success p-1 text-success-foreground">
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-bold leading-[1.35]">{course.title}</h3>
            <LevelBadge level={course.level} />
          </div>
          <p className="line-clamp-1 text-[12.5px] leading-normal text-muted-foreground">{course.description}</p>
          {enrollment && <div className="mt-1.5 max-w-[240px]">{progressBar(course, percent)}</div>}
        </div>

        <div className="relative z-20 flex shrink-0 items-center gap-1.5">
          <FavoriteToggle
            isFavorite={isFavorite(course.id)}
            pending={togglingId === course.id}
            onToggle={(next) => toggleFavorite({ courseId: course.id, favorite: next, course })}
            className="h-8 w-8"
          />
          <Button
            asChild
            className="h-auto rounded-[9px] bg-primary px-3 py-2 text-[12.5px] font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Link to={routes.learner.coursePlayer(course.id)}>
              <Play aria-hidden="true" className="h-3.5 w-3.5" />
              {ctaLabelFor(enrollment, isCompleted)}
            </Link>
          </Button>
        </div>
      </div>
    );
  };

  const renderCatalog = (list: Course[]) =>
    view === 'list' ? (
      <div data-testid="catalog-list" className="flex flex-col gap-3">{list.map(renderCourseRow)}</div>
    ) : (
      <div data-testid="catalog-grid" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((course) => renderCourseCard(course, false))}
      </div>
    );

  const viewToggleButton = (value: CatalogView, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={view === value}
      onClick={() => selectCatalogView(value)}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
        view === value ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-primary',
      )}
    >
      {icon}
    </button>
  );

  return (
    <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
      <div className="mb-[22px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('courses.title')}</h1>
        <p className="max-w-[680px] text-sm text-muted-foreground">{t('courses.subtitle')}</p>
      </div>

      {/* Filters on the left, free-text search to their right, view toggle far right (#360). */}
      <div className="mb-[22px] flex flex-wrap items-center gap-2.5">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label={t('courses.category')}
          className={selectClasses}
        >
          <option value="all">{t('courses.allCategories')}</option>
          {availableCategories.map((category) => (
            <option key={category.id} value={category.id}>{categoryName(category)}</option>
          ))}
        </select>
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

        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('courses.searchPlaceholder')}
            className="h-auto rounded-xl bg-card py-[11px] pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] font-semibold text-muted-foreground hover:text-primary"
          >
            {t('common.clear')}
          </button>
        )}

        <div className="flex items-center gap-0.5 rounded-xl border border-input bg-card p-0.5">
          {viewToggleButton('card', t('courses.viewAsCards'), <LayoutGrid aria-hidden="true" className="h-4 w-4" />)}
          {viewToggleButton('list', t('courses.viewAsList'), <List aria-hidden="true" className="h-4 w-4" />)}
        </div>
      </div>

      {/* Recommended section — a highlighted "For you" strip (always cards, independent of the
          list/card toggle) shown only when the learner has a known assessment level AND is NOT
          actively filtering: once you filter/search you're browsing results, so a level-matched
          strip that ignores the filters (and can sit above a "no matches" empty state) is hidden. */}
      {!hasActiveFilters && profile?.assessment_level != null && recommendedCourses.length > 0 && (
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

      {/* All courses heading — the separator under the recommended strip; shown only when that
          strip is (i.e. no active filters + a recommended match). */}
      {!hasActiveFilters && recommendedCourses.length > 0 && (
        <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('assessment.recommendations.allCourses')}</h2>
      )}

      {filteredCourses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('courses.noCoursesAvailable')}
          description={
            hasActiveFilters
              ? t('courses.noCoursesMatch')
              : t('courses.noCoursesForOrg')
          }
          className="rounded-2xl border-[#d6d8e0] bg-card"
        />
      ) : (
        renderCatalog(filteredCourses)
      )}
    </AppLayout>
  );
}
