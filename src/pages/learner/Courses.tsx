import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LevelBadge } from '@/components/ui/level-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useFlash } from '@/hooks/useFlash';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { Course, Enrollment } from '@/lib/types';
import { BookOpen, Check, CheckCircle2, Loader2, LogOut, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';

export default function LearnerCourses() {
  const { currentOrg, profile } = useAuth();
  const orgGuard = useOrgGuard();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { flashed, flash } = useFlash();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [unenrollDialog, setUnenrollDialog] = useState<{ open: boolean; course: Course | null; enrollment: Enrollment | null }>({
    open: false,
    course: null,
    enrollment: null,
  });

  const query = useLearnerCourses(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const courses = query.data?.courses ?? [];
  const enrollments = query.data?.enrollments ?? [];

  const enrollMutation = useMutation({
    mutationFn: ({ orgId, courseId }: { orgId: string; courseId: string }) =>
      callApi('/api/enroll', { orgId, courseId }),
    onSuccess: (_data, variables) => {
      flash(`enr-${variables.courseId}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerCourses.list(currentOrg?.id) });
      // Enrolling changes what the learner dashboard shows — keep its cache fresh.
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerDashboard.detail(currentOrg?.id) });
    },
    onError: (error) => {
      toast({
        title: t('courses.enrollmentFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
  });

  const unenrollMutation = useMutation({
    mutationFn: ({ enrollmentId }: { enrollmentId: string }) =>
      callApi('/api/unenroll', { enrollmentId }),
    onSuccess: () => {
      toast({
        title: t('courses.unenrolledFromCourse'),
        description: t('courses.unenrolledDescription', { courseTitle: unenrollDialog.course?.title }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerCourses.list(currentOrg?.id) });
      // Unenrolling changes what the learner dashboard shows — keep its cache fresh.
      queryClient.invalidateQueries({ queryKey: queryKeys.learnerDashboard.detail(currentOrg?.id) });
    },
    onError: (error) => {
      toast({
        title: t('courses.unenrollFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    },
    // Close the dialog whether or not the request succeeded, matching the
    // pre-migration handler (which closed unconditionally after the request).
    onSettled: () => setUnenrollDialog({ open: false, course: null, enrollment: null }),
  });

  const handleEnroll = (courseId: string) => {
    if (!currentOrg) return;
    enrollMutation.mutate({ orgId: currentOrg.id, courseId });
  };

  const handleUnenroll = () => {
    if (!unenrollDialog.enrollment) return;
    unenrollMutation.mutate({ enrollmentId: unenrollDialog.enrollment.id });
  };

  const unenrolling = unenrollMutation.isPending;

  const getEnrollmentStatus = (courseId: string) => {
    return enrollments.find(e => e.course_id === courseId);
  };

  const clearFilters = () => {
    setSearch('');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const hasActiveFilters = search.trim() !== '' || levelFilter !== 'all' || statusFilter !== 'all';

  const filteredCourses = courses.filter(course => {
    // Search filter
    const matchesSearch = search === '' ||
      course.title.toLowerCase().includes(search.toLowerCase()) ||
      course.description?.toLowerCase().includes(search.toLowerCase());

    // Level filter
    const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

    // Status filter
    const enrollment = getEnrollmentStatus(course.id);
    let matchesStatus = true;
    if (statusFilter === 'enrolled') {
      matchesStatus = !!enrollment && enrollment.status !== 'completed';
    } else if (statusFilter === 'completed') {
      matchesStatus = enrollment?.status === 'completed';
    } else if (statusFilter === 'not_enrolled') {
      matchesStatus = !enrollment;
    }

    return matchesSearch && matchesLevel && matchesStatus;
  });

  if (orgGuard === 'loading' || query.isLoading) {
    return (
      <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">{t('common.noOrgSelected')}</p>
          <p className="text-sm text-muted-foreground">{t('courses.joinOrgToAccessCourses')}</p>
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
    const justEnrolled = flashed(`enr-${course.id}`);
    const isEnrolling = enrollMutation.isPending && enrollMutation.variables?.courseId === course.id;

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
          {isCompleted ? (
            <span
              data-testid="status-badge-completed"
              className={`absolute ${showChip ? 'left-3' : 'right-3'} top-3 inline-flex items-center gap-[5px] rounded-[7px] bg-success px-[11px] py-[5px] text-[11px] font-bold text-success-foreground`}
            >
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
              {t('dashboard.completed')}
            </span>
          ) : enrollment ? (
            <span
              data-testid="status-badge-enrolled"
              className={`absolute ${showChip ? 'left-3' : 'right-3'} top-3 inline-flex items-center rounded-[7px] bg-[rgba(13,21,60,0.45)] px-[11px] py-[5px] text-[11px] font-bold text-white`}
            >
              {t('common.enrolled')}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-[9px] px-[18px] pb-[18px] pt-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14.5px] font-bold leading-[1.35]">{course.title}</h3>
            <LevelBadge level={course.level} className="shrink-0" />
          </div>
          <p className="line-clamp-2 text-[12.5px] leading-normal text-muted-foreground">
            {course.description}
          </p>

          <div className="mt-auto flex items-center gap-2">
            {justEnrolled ? (
              // Transient post-enroll morph; reverts to Continue when the flash expires
              <Button className="h-auto flex-1 rounded-[10px] border border-success bg-success px-3 py-[9px] text-[13px] font-bold text-success-foreground hover:bg-success">
                <Check aria-hidden="true" />
                {t('common.enrolled')}
              </Button>
            ) : enrollment ? (
              <Button
                asChild
                className={cn(
                  'h-auto flex-1 rounded-[10px] px-3 py-[9px] text-[13px] font-bold',
                  isCompleted
                    ? 'border border-[#cfd6ef] bg-card text-primary hover:bg-accent'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                <Link to={routes.learner.coursePlayer(course.id)}>
                  <Play aria-hidden="true" />
                  {isCompleted ? t('courses.reviewCourse') : t('common.continue')}
                </Link>
              </Button>
            ) : (
              <Button
                onClick={() => handleEnroll(course.id)}
                disabled={isEnrolling}
                className="h-auto flex-1 rounded-[10px] border border-[#cfd6ef] bg-card px-3 py-[9px] text-[13px] font-bold text-primary hover:bg-accent"
              >
                {isEnrolling ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t('common.enrolling')}
                  </>
                ) : (
                  t('common.enroll')
                )}
              </Button>
            )}
            {enrollment && (
              <Button
                variant="outline"
                size="icon"
                title={t('courses.unenrollFromCourse')}
                aria-label={t('courses.unenrollFromCourse')}
                onClick={() => setUnenrollDialog({ open: true, course, enrollment })}
                className="h-9 w-9 shrink-0 rounded-[10px] text-[#9aa0af] hover:border-[#f0c7c7] hover:bg-card hover:text-destructive"
              >
                <LogOut aria-hidden="true" className="h-[15px] w-[15px]" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout breadcrumbs={[{ label: t('nav.courses') }]}>
      {/* Page header */}
      <div className="mb-[22px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('courses.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('courses.subtitle', { orgName: currentOrg.name })}</p>
      </div>

      {/* Search and filters */}
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
          <option value="enrolled">{t('courses.statusOptions.enrolled')}</option>
          <option value="completed">{t('courses.statusOptions.completed')}</option>
          <option value="not_enrolled">{t('courses.statusOptions.notEnrolled')}</option>
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
      {profile?.assessment_level != null && (() => {
        const recommended = courses.filter(c => c.level === profile.assessment_level);
        if (recommended.length === 0) return null;
        return (
          <div className="mb-8" data-testid="recommended-section">
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[17px] font-bold">{t('assessment.recommendations.forYou')}</h2>
              <LevelBadge level={profile.assessment_level} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {recommended.map((course) => renderCourseCard(course, true))}
            </div>
          </div>
        );
      })()}

      {/* All courses heading — shown when a recommended section is also visible */}
      {profile?.assessment_level != null && courses.some(c => c.level === profile.assessment_level) && (
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

      {/* Unenroll Confirmation Dialog */}
      <AlertDialog
        open={unenrollDialog.open}
        onOpenChange={(open) => !open && setUnenrollDialog({ open: false, course: null, enrollment: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('courses.unenrollConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans i18nKey="courses.unenrollConfirmDescription" values={{ courseTitle: unenrollDialog.course?.title }} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unenrolling}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnenroll}
              disabled={unenrolling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {unenrolling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.unenrolling')}
                </>
              ) : (
                t('common.unenroll')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
