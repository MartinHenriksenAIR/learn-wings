import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useCommunityGate } from '@/hooks/useCommunityGate';
import { useLearnerDashboard } from '@/hooks/useLearnerDashboard';
import { GamificationSummary } from '@/components/learner/GamificationSummary';
import { Leaderboard } from '@/components/learner/Leaderboard';
import { DashboardCommunitySection } from '@/components/learner/DashboardCommunitySection';
import { BookOpen, Clock, Award, TrendingUp, Sparkles } from 'lucide-react';

export default function LearnerDashboard() {
  const { currentOrg, profile, memberships, isPlatformAdmin, isOrgAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  // Solo learners run against a hidden placeholder org; the leaderboard is org-scoped
  // and meaningless for them, so it's suppressed for the individual tier.
  const isIndividual = currentOrg?.kind === 'individual';
  const communityGate = useCommunityGate();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const query = useLearnerDashboard(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  if (orgGuard === 'loading' || query.isLoading) {
    return (
      <AppLayout title={t('dashboard.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    // A non-admin with no membership is a blocked walk-in — registration is
    // invitation-only. Platform admins (and anyone with memberships but no selection)
    // keep the generic no-org-selected copy.
    const showInvitationOnly = memberships.length === 0 && !isPlatformAdmin;
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={showInvitationOnly ? t('dashboard.invitationOnlyTitle') : t('common.noOrgSelected')}
            description={showInvitationOnly ? t('dashboard.invitationOnlyDescription') : t('common.joinOrgToContinue')}
          />
        </div>
      </AppLayout>
    );
  }

  // A failed dashboard fetch must not masquerade as an all-zero hub; show a
  // distinct error fork with retry instead.
  if (query.isError || !query.data) {
    return (
      <AppLayout title={t('dashboard.title')}>
        <div className="flex h-64 items-center justify-center">
          <QueryErrorState onRetry={() => query.refetch()} />
        </div>
      </AppLayout>
    );
  }

  const { snapshot, xp, level, streak, leaderboard, showLeaderboard } = query.data;
  const firstName = profile?.first_name || profile?.full_name;

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {firstName ? t('dashboard.welcomeBack', { name: firstName }) : t('dashboard.welcome')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
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

      {/* Progress snapshot — compact; each card deep-links into Min Træning. */}
      <div data-testid="dashboard-snapshot" className="mb-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('dashboard.started')}
          value={snapshot.started}
          icon={<BookOpen className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.training)}
        />
        <StatCard
          label={t('dashboard.inProgress')}
          value={snapshot.inProgress}
          icon={<Clock className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.training)}
        />
        <StatCard
          label={t('dashboard.completed')}
          value={snapshot.completed}
          icon={<Award className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.training)}
        />
        <StatCard
          label={t('dashboard.overallProgress')}
          value={`${snapshot.overallPct}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          onClick={() => navigate(routes.learner.training)}
        />
      </div>

      <GamificationSummary xp={xp} level={level} streak={streak} />

      {/* Server decides visibility: false for the individual tier (#354) and for a
          per-org leaderboard opt-out (#369). Hides the widget entirely rather than
          rendering an empty board for a disabled feature. */}
      {showLeaderboard && <Leaderboard leaderboard={leaderboard} />}

      {communityGate === 'allowed' && (
        <DashboardCommunitySection orgId={isIndividual ? undefined : currentOrg.id} />
      )}
    </AppLayout>
  );
}
