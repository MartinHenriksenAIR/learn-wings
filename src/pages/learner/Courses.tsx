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
import { useCourseCategories } from '@/hooks/useCourseCategories';
import { useFavorites, useToggleFavorite } from '@/hooks/useFavorites';
import { FavoriteToggle } from '@/components/learner/FavoriteToggle';
import { FilterSelect } from '@/components/FilterSelect';
import { Course, CourseCategory, Enrollment } from '@/lib/types';
import { BookOpen, CheckCircle2, Play, Search } from 'lucide-react';
import { useListView } from '@/hooks/useListView';
import { ListViewToggle } from '@/components/learner/ListViewToggle';

const NO_COURSES: Course[] = [];
const NO_ENROLLMENTS: Enrollment[] = [];
const NO_CATEGORIES: CourseCategory[] = [];

export default function LearnerCourses() {
  const { currentOrg, profile, isPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [view, setView] = useListView('kursuskatalog-view');

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

  const availableCategories = useMemo(
    () => categories.filter((c) => courses.some((course) => course.category_id === c.id)),
    [categories, courses],
  );

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

  const recommendedCourses = profile?.assessment_level != null
    ? courses.filter(c => c.level === profile.assessment_level)
    : [];

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
      <AppLayout headerLabel={t('nav.courses')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout headerLabel={t('nav.courses')}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="mb-4 h-12 w-12 text-legacy-muted-foreground/50" />
          <p className="text-legacy-muted-foreground">
            {isPlatformAdmin ? t('common.noOrgSelected') : t('dashboard.invitationOnlyTitle')}
          </p>
          <p className="text-sm text-legacy-muted-foreground">
            {isPlatformAdmin ? t('courses.joinOrgToAccessCourses') : t('dashboard.invitationOnlyDescription')}
          </p>
        </div>
      </AppLayout>
    );
  }

  if (query.isError) {
    return (
      <AppLayout headerLabel={t('nav.courses')}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => query.refetch()} />
        </div>
      </AppLayout>
    );
  }

  const ctaLabelFor = (enrollment: Enrollment | undefined, isCompleted: boolean) =>
    isCompleted ? t('courses.reviewCourse') : enrollment ? t('common.continue') : t('courses.startCourse');

  const detailOverlay = (course: Course) => (
    <Link
      to={routes.learner.courseDetail(course.id)}
      aria-label={t('courses.readAbout', { title: course.title })}
      className="absolute inset-0 z-10 rounded-legacy-2xl"
    />
  );

  const courseCta = (course: Course, enrollment: Enrollment | undefined, isCompleted: boolean) => (
    <Button
      asChild
      className="relative z-20 h-auto self-start rounded-[9px] bg-legacy-primary px-3 py-1.5 text-[12px] font-bold text-legacy-primary-foreground hover:bg-legacy-primary/90"
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
        <div className="h-full rounded-full bg-legacy-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs font-semibold text-legacy-muted-foreground">{percent}%</span>
    </div>
  );

  const percentFor = (course: Course, isCompleted: boolean) => {
    const total = progressData[course.id]?.total ?? 0;
    const completed = progressData[course.id]?.completed ?? 0;
    return isCompleted ? 100 : total === 0 ? 0 : Math.round((completed / total) * 100);
  };

  const renderCourseCard = (course: Course, showChip: boolean) => {
    const enrollment = getEnrollmentStatus(course.id);
    const isCompleted = enrollment?.status === 'completed';
    const percent = percentFor(course, isCompleted);

    return (
      <div
        key={course.id}
        className="hover-lift-lg relative flex flex-col overflow-hidden rounded-legacy-2xl border border-legacy-border bg-legacy-card"
      >
        {detailOverlay(course)}

        <div className="relative h-[118px] bg-gradient-to-br from-legacy-primary/80 to-legacy-primary">
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
              className="absolute right-3 top-3 inline-flex items-center rounded-[7px] bg-legacy-primary px-[11px] py-[5px] text-[11px] font-bold text-legacy-primary-foreground"
            >
              {t('assessment.recommendations.chip')}
            </span>
          )}
          {isCompleted && (
            <span
              data-testid="status-badge-completed"
              className={`absolute ${showChip ? 'left-3' : 'right-3'} top-3 inline-flex items-center gap-[5px] rounded-[7px] bg-legacy-success px-[11px] py-[5px] text-[11px] font-bold text-legacy-success-foreground`}
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
          <p className="line-clamp-2 text-[12.5px] leading-normal text-legacy-muted-foreground">
            {course.description}
          </p>

          {enrollment && <div className="mt-auto">{progressBar(course, percent)}</div>}
        </div>
      </div>
    );
  };

  const renderCourseRow = (course: Course) => {
    const enrollment = getEnrollmentStatus(course.id);
    const isCompleted = enrollment?.status === 'completed';
    const percent = percentFor(course, isCompleted);

    return (
      <div
        key={course.id}
        className="hover-lift-lg relative flex items-center gap-4 rounded-legacy-xl border border-legacy-border bg-legacy-card p-3"
      >
        {detailOverlay(course)}

        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-legacy-lg bg-gradient-to-br from-legacy-primary/80 to-legacy-primary">
          {course.thumbnail_url && (
            <img src={course.thumbnail_url} alt={course.title} className="absolute inset-0 h-full w-full object-cover" />
          )}
          {isCompleted && (
            <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded-[6px] bg-legacy-success p-1 text-legacy-success-foreground">
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[14px] font-bold leading-[1.35]">{course.title}</h3>
            <LevelBadge level={course.level} />
          </div>
          <p className="line-clamp-1 text-[12.5px] leading-normal text-legacy-muted-foreground">{course.description}</p>
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
            className="h-auto min-w-[150px] rounded-[9px] bg-legacy-primary px-3 py-2 text-[12.5px] font-bold text-legacy-primary-foreground hover:bg-legacy-primary/90"
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

  return (
    <AppLayout headerLabel={t('nav.courses')}>
      <div className="mb-[22px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('courses.title')}</h1>
        <p className="max-w-[680px] text-sm text-legacy-muted-foreground">{t('courses.subtitle')}</p>
      </div>

      <div className="mb-[22px] flex flex-wrap items-center gap-2.5">
        <FilterSelect
          label={t('courses.category')}
          value={categoryFilter}
          onValueChange={setCategoryFilter}
          options={[
            { value: 'all', label: t('courses.allCategories') },
            ...availableCategories.map((category) => ({ value: category.id, label: categoryName(category) })),
          ]}
        />
        <FilterSelect
          label={t('courses.level')}
          value={levelFilter}
          onValueChange={setLevelFilter}
          options={[
            { value: 'all', label: t('courses.allLevels') },
            { value: 'basic', label: t('courses.levels.basic') },
            { value: 'intermediate', label: t('courses.levels.intermediate') },
            { value: 'advanced', label: t('courses.levels.advanced') },
          ]}
        />
        <FilterSelect
          label={t('courses.status')}
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: 'all', label: t('courses.anyStatus') },
            { value: 'in_progress', label: t('courses.statusOptions.inProgress') },
            { value: 'completed', label: t('courses.statusOptions.completed') },
            { value: 'not_started', label: t('courses.statusOptions.notStarted') },
          ]}
        />

        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('courses.searchPlaceholder')}
            className="h-auto rounded-legacy-xl bg-legacy-card py-[11px] pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="whitespace-nowrap rounded-legacy-lg px-2.5 py-2 text-[13px] font-semibold text-legacy-muted-foreground hover:text-legacy-primary"
          >
            {t('common.clear')}
          </button>
        )}

        <ListViewToggle view={view} onChange={setView} />
      </div>

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
          className="rounded-legacy-2xl border-[#d6d8e0] bg-legacy-card"
        />
      ) : (
        renderCatalog(filteredCourses)
      )}
    </AppLayout>
  );
}
