import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { StatCard } from '@/components/ui/stat-card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { LevelBadge } from '@/components/ui/level-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useFlash } from '@/hooks/useFlash';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useLearnerDashboard } from '@/hooks/useLearnerDashboard';
import { callApiRaw } from '@/lib/api-client';
import { Enrollment, Course } from '@/lib/types';
import { BookOpen, Clock, Award, Play, ArrowRight, TrendingUp, Sparkles } from 'lucide-react';
import { CertificateCard } from '@/components/learner/CertificateCard';
import { formatDate } from '@/lib/date-locale';
import { toast } from '@/components/ui/sonner';

export default function LearnerDashboard() {
  const { currentOrg, profile, memberships, isPlatformAdmin, isOrgAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { features } = usePlatformSettings();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { flashed, flash } = useFlash();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const query = useLearnerDashboard(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const enrollments: (Enrollment & { course: Course })[] = query.data?.enrollments ?? [];
  const progressData: Record<string, { total: number; completed: number }> = query.data?.progress ?? {};
  const thumbnailUrls: Record<string, string> = query.data?.thumbnailUrls ?? {};

  const inProgressCourses = enrollments.filter(e => e.status === 'enrolled');
  const completedCourses = enrollments.filter(e => e.status === 'completed');
  const completedEnrollments = completedCourses;
  const totalProgress = enrollments.length > 0
    ? (completedCourses.length / enrollments.length) * 100
    : 0;

  const handleDownloadCertificate = async (enrollmentId: string, courseTitle: string) => {
    setDownloadingId(enrollmentId);

    try {
      const response = await callApiRaw('/api/generate-certificate', { enrollmentId });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificate-${courseTitle.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Routine confirmation: in-button "Saved" morph on the card, no toast
      flash(enrollmentId);
    } catch (_err) {
      toast({
        title: t('certificates.downloadFailed'),
        description: t('certificates.downloadFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (orgGuard === 'loading' || query.isLoading) {
    return (
      <AppLayout title={t('dashboard.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    const isNoMembership = memberships.length === 0;
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={isNoMembership ? t('dashboard.noMembershipTitle') : t('common.noOrgSelected')}
            description={isNoMembership ? t('dashboard.noMembershipDescription') : t('common.joinOrgToContinue')}
          />
        </div>
      </AppLayout>
    );
  }

  // A failed dashboard fetch must not masquerade as the first-time-user hero
  // (all-empty derived state); show a distinct error fork with retry instead.
  if (query.isError) {
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => query.refetch()} />
        </div>
      </AppLayout>
    );
  }

  const nextUp = inProgressCourses[0];

  // ----- Hero variants: in-progress / all caught up / first-time user -----
  const heroProgress = nextUp ? progressData[nextUp.course_id] : undefined;
  const heroDone = heroProgress?.completed ?? 0;
  const heroTotal = heroProgress?.total ?? 0;
  const hero = nextUp
    ? {
        badge: t('dashboard.heroContinueBadge'),
        title: nextUp.course?.title,
        description: nextUp.course?.description,
        cta: t('dashboard.heroResumeCta'),
        progressLabel: heroTotal > 0 ? t('dashboard.heroLessonsDone', { done: heroDone, total: heroTotal }) : null,
        pct: heroTotal > 0 ? (heroDone / heroTotal) * 100 : 0,
        to: routes.learner.coursePlayer(nextUp.course_id),
      }
    : completedCourses.length > 0
      ? {
          badge: t('dashboard.heroAllCaughtUpBadge'),
          title: t('dashboard.heroAllDoneTitle'),
          description: t('dashboard.heroAllDoneDescription'),
          cta: t('dashboard.heroStartNewCta'),
          progressLabel: t('dashboard.heroCoursesCompleted', {
            completed: completedCourses.length,
            total: enrollments.length,
          }),
          pct: 100,
          to: routes.learner.courses,
        }
      : {
          badge: t('dashboard.heroFirstTimeBadge'),
          title: t('dashboard.heroFirstTimeTitle'),
          description: t('dashboard.heroFirstTimeDescription'),
          cta: t('dashboard.browseCourses'),
          progressLabel: t('dashboard.heroPickFirstCourse'),
          pct: 0,
          to: routes.learner.courses,
        };

  const firstName = profile?.first_name || profile?.full_name;

  return (
    <AppLayout>
      {/* Welcome header */}
      <div className="mb-6">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {firstName ? t('dashboard.welcomeBack', { name: firstName }) : t('dashboard.welcome')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.pickUpWhereYouLeftOff')}</p>
      </div>

      {/* Assessment banner — shown only to plain learners who haven't taken the assessment yet */}
      {profile && !isPlatformAdmin && !isOrgAdmin && profile.assessment_level == null && (
        <div
          data-testid="assessment-banner"
          className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4"
        >
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">{t('assessment.banner.title')}</p>
            <p className="text-[12.5px] text-muted-foreground">{t('assessment.banner.body')}</p>
          </div>
          <Button
            onClick={() => navigate(routes.learner.assessment)}
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t('assessment.banner.cta')}
          </Button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="mb-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashboard.coursesEnrolled')}
          value={enrollments.length}
          icon={<BookOpen className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.courses)}
        />
        <StatCard
          label={t('dashboard.inProgress')}
          value={inProgressCourses.length}
          icon={<Clock className="h-5 w-5" />}
          onClick={() => navigate(nextUp ? routes.learner.coursePlayer(nextUp.course_id) : routes.learner.courses)}
        />
        <StatCard
          label={t('dashboard.completed')}
          value={completedCourses.length}
          icon={<Award className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.courses)}
        />
        <StatCard
          label={t('dashboard.overallProgress')}
          value={`${Math.round(totalProgress)}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.courses)}
        />
      </div>

      {/* Hero card */}
      <div
        data-testid="dashboard-hero"
        className="gradient-hero relative mb-7 flex items-center gap-7 overflow-hidden rounded-[20px] px-[30px] py-7 text-white"
      >
        <div
          aria-hidden="true"
          className="absolute -right-[60px] -top-20 h-[280px] w-[280px] rounded-full bg-white/[0.06]"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-[120px] right-[60px] h-[220px] w-[220px] rounded-full bg-white/5"
        />
        <div className="relative min-w-0 flex-1">
          <span className="mb-3 inline-block rounded-[7px] bg-white/[0.14] px-[11px] py-[5px] text-[11px] font-bold uppercase tracking-[0.08em]">
            {hero.badge}
          </span>
          <h2 className="mb-1.5 font-display text-[22px] font-extrabold tracking-[-0.01em]">{hero.title}</h2>
          {hero.description && (
            <p className="mb-[18px] max-w-[480px] text-[13.5px] text-white/75">{hero.description}</p>
          )}
          <div className="flex items-center gap-4">
            <Button
              asChild
              className="h-auto rounded-[11px] bg-white px-[18px] py-[11px] text-[13.5px] font-bold text-primary hover:bg-[#e9edfb]"
            >
              <Link to={hero.to}>
                <Play aria-hidden="true" />
                {hero.cta}
              </Link>
            </Button>
            {hero.progressLabel && (
              <span className="text-[12.5px] font-semibold text-white/85">{hero.progressLabel}</span>
            )}
          </div>
        </div>
        <ProgressRing
          pct={hero.pct}
          size={120}
          stroke={9}
          fg="#ffffff"
          bg="rgba(255,255,255,0.2)"
          labelColor="#ffffff"
          className="relative shrink-0"
        />
      </div>

      {/* Continue Learning */}
      <div className="mb-8">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="font-display text-[17px] font-bold">{t('dashboard.continueLearning')}</h2>
          <Button asChild variant="ghost" size="sm" className="text-[13px] font-bold text-primary hover:text-primary">
            <Link to={routes.learner.courses}>
              {t('dashboard.viewAllCourses')}
              <ArrowRight aria-hidden="true" className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {inProgressCourses.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={t('dashboard.noCoursesInProgress')}
            description={t('dashboard.startLearning')}
            action={
              <Button asChild>
                <Link to={routes.learner.courses}>{t('dashboard.browseCourses')}</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {inProgressCourses.slice(0, 3).map((enrollment) => {
              const progress = progressData[enrollment.course_id];
              const progressPercent = progress
                ? (progress.completed / progress.total) * 100
                : 0;

              return (
                <div
                  key={enrollment.id}
                  className="hover-lift flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <div className="relative h-[110px] bg-gradient-to-br from-primary/80 to-primary">
                    {thumbnailUrls[enrollment.course_id] && (
                      <img
                        src={thumbnailUrls[enrollment.course_id]}
                        alt={enrollment.course?.title || ''}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    {enrollment.course?.level && (
                      <LevelBadge level={enrollment.course.level} className="absolute bottom-3 left-3.5" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
                    <h3 className="text-[14.5px] font-bold leading-[1.35]">{enrollment.course?.title}</h3>
                    <div className="mt-auto flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eceef3]">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
                        {progress?.completed || 0}/{progress?.total || 0}
                      </span>
                    </div>
                    <Button
                      asChild
                      className="h-auto w-full rounded-[10px] bg-accent px-3 py-[9px] text-[13px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                    >
                      <Link to={routes.learner.coursePlayer(enrollment.course_id)}>
                        <Play aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('common.continue')}
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Courses */}
      {completedCourses.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('dashboard.completedCourses')}</h2>
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {completedCourses.map((enrollment) => (
              <div
                key={enrollment.id}
                className="hover-lift flex items-center gap-3.5 rounded-2xl border border-border bg-card px-[18px] py-4"
              >
                <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-success/10 text-success">
                  <Award className="h-5 w-5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13.5px] font-bold">{enrollment.course?.title}</span>
                  <span className="text-xs text-[#9aa0af]">
                    {t('common.completedOn')} {formatDate(new Date(enrollment.completed_at!), 'P', i18n.language)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Certificates */}
      {features.certificates_enabled && (
        <div id="certificates">
          <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('certificates.title')}</h2>
          {completedEnrollments.length === 0 ? (
            <EmptyState
              icon={<Award className="h-6 w-6" />}
              title={t('certificates.noCertificates')}
              description={t('certificates.noCertificatesDescription')}
            />
          ) : (
            <div className="grid gap-3.5 md:grid-cols-2">
              {completedEnrollments.map((enrollment) => (
                <CertificateCard
                  key={enrollment.id}
                  enrollment={enrollment}
                  profile={profile}
                  downloading={downloadingId === enrollment.id}
                  saved={flashed(enrollment.id)}
                  onDownload={handleDownloadCertificate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}
