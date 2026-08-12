import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { LevelBadge } from '@/components/ui/level-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useFlash } from '@/hooks/useFlash';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useLearnerTraining } from '@/hooks/useLearnerTraining';
import { callApiRaw } from '@/lib/api-client';
import { BookOpen, Award, Play } from 'lucide-react';
import { CertificateCard } from '@/components/learner/CertificateCard';
import { MandatoryCourses } from '@/components/learner/MandatoryCourses';
import { FavoriteCourses } from '@/components/learner/FavoriteCourses';
import { formatDate } from '@/lib/date-locale';
import { toast } from '@/components/ui/sonner';

export default function LearnerTraining() {
  const { currentOrg, profile, memberships } = useAuth();
  const orgGuard = useOrgGuard();
  const { features } = usePlatformSettings();
  const { t, i18n } = useTranslation();
  const { flashed, flash } = useFlash();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const query = useLearnerTraining(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  const data = query.data;
  const progressData: Record<string, { total: number; completed: number }> = data?.progress ?? {};
  const thumbnailUrls: Record<string, string> = data?.thumbnailUrls ?? {};

  // Site-specific derivation lives at the call site (frontend rules): split
  // enrollments by status and aggregate lesson counts across ALL enrollments.
  // Keyed on the stable `data` reference so the memo isn't defeated by the
  // fresh `?? []`/`?? {}` fallbacks created on every render.
  const { inProgress, completed, lessonTotal, lessonDone, pct } = useMemo(() => {
    const list = data?.enrollments ?? [];
    const prog = data?.progress ?? {};
    let total = 0;
    let done = 0;
    for (const enrollment of list) {
      const p = prog[enrollment.course_id];
      if (p) {
        total += p.total;
        done += p.completed;
      }
    }
    return {
      inProgress: list.filter((e) => e.status === 'enrolled'),
      completed: list.filter((e) => e.status === 'completed'),
      lessonTotal: total,
      lessonDone: done,
      pct: total ? Math.round((done / total) * 100) : 0,
    };
  }, [data]);

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

      // In-button "Saved" morph on the card, no toast.
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
      <AppLayout title={t('training.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    const isNoMembership = memberships.length === 0;
    return (
      <AppLayout title={t('training.title')}>
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

  if (query.isError) {
    return (
      <AppLayout title={t('training.title')}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => query.refetch()} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('training.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('training.subtitle')}</p>
      </div>

      {/* 1 · Slim progress strip — a compact lesson-level aggregate, not a hero. */}
      <div
        data-testid="training-progress-strip"
        className="mb-7 rounded-2xl border border-border bg-card px-5 py-4"
      >
        <div className="mb-2.5 flex items-center justify-between gap-4">
          <span className="text-[13.5px] font-semibold text-muted-foreground">
            {lessonTotal > 0
              ? t('training.progress.summary', { done: lessonDone, total: lessonTotal })
              : t('training.progress.empty')}
          </span>
          <span className="text-[13.5px] font-bold tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {/* 2 · Mandatory — the learner's mandatory-assigned courses (#365). */}
      <MandatoryCourses orgId={currentOrg.id} />

      {/* 3 · Continue (in-progress) — live resume cards. */}
      <section className="mb-8">
        <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('training.continue.title')}</h2>

        {inProgress.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={t('training.continue.empty')}
            action={
              <Button asChild>
                <Link to={routes.learner.courses}>{t('dashboard.browseCourses')}</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {inProgress.map((enrollment) => {
              const p = progressData[enrollment.course_id];
              const coursePct = p && p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;

              return (
                <div
                  key={enrollment.id}
                  data-testid="training-continue-card"
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
                      <Progress value={coursePct} className="h-1.5 flex-1" />
                      <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-muted-foreground">
                        {p?.completed ?? 0}/{p?.total ?? 0}
                      </span>
                    </div>
                    <Button
                      asChild
                      className="h-auto w-full rounded-[10px] bg-accent px-3 py-[9px] text-[13px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                    >
                      <Link to={routes.learner.coursePlayer(enrollment.course_id, 'training')}>
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
      </section>

      {/* 4 · Favorites — the learner's favorited courses (#358/#380). */}
      <FavoriteCourses orgId={currentOrg.id} />

      {/* 5 · Completed (+ certificate). */}
      <section className="mb-8">
        <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('training.completed.title')}</h2>

        {completed.length === 0 ? (
          <EmptyState icon={<Award className="h-6 w-6" />} title={t('training.completed.empty')} />
        ) : features.certificates_enabled ? (
          <div className="grid gap-3.5 md:grid-cols-2">
            {completed.map((enrollment) => (
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
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
            {completed.map((enrollment) => (
              <div
                key={enrollment.id}
                data-testid="training-completed-card"
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
        )}
      </section>
    </AppLayout>
  );
}
