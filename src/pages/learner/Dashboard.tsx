import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { useCommunityGate } from '@/hooks/useCommunityGate';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import { useLearnerDashboard } from '@/hooks/useLearnerDashboard';
import { DashboardHero } from '@/components/learner/dashboard/DashboardHero';
import { DashboardStats } from '@/components/learner/dashboard/DashboardStats';
import { DashboardCommunity } from '@/components/learner/dashboard/DashboardCommunity';
import { DashboardLeaderboard } from '@/components/learner/dashboard/DashboardLeaderboard';
import { DashboardEvents } from '@/components/learner/dashboard/DashboardEvents';
import type { CommunityPost } from '@/lib/community-types';

const RECENT_POSTS = 3;
const UPCOMING_EVENTS = 5;

/** "Emil Vladinov" → "EV"; a single name → its first letter; nothing → "?". */
function initialsOf(first?: string | null, last?: string | null, full?: string | null): string {
  const parts = [first, last].filter(Boolean) as string[];
  const tokens = parts.length > 0 ? parts : (full ?? '').split(/\s+/).filter(Boolean);
  const letters = [tokens[0], tokens.length > 1 ? tokens[tokens.length - 1] : undefined]
    .filter(Boolean)
    .map((tok) => (tok as string)[0].toUpperCase());
  return letters.join('') || '?';
}

export default function LearnerDashboard() {
  const { currentOrg, profile, memberships, isPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  // Solo learners run against a hidden placeholder org; community content is
  // global-only for them, so the org-scoped read is skipped (#354).
  const isIndividual = currentOrg?.kind === 'individual';
  const communityGate = useCommunityGate();
  const communityOn = communityGate === 'allowed';
  const { t } = useTranslation();
  const navigate = useNavigate();

  const query = useLearnerDashboard(currentOrg?.id, {
    enabled: orgGuard === 'ready' && !!currentOrg,
  });

  // Community and events are two cuts of the same posts, so both scopes are read
  // once here and reshaped at the call site rather than fetched per section.
  const communityOrgId = isIndividual ? undefined : currentOrg?.id;
  const globalPosts = useCommunityEvents('global', communityOrgId, { enabled: communityOn });
  const orgPosts = useCommunityEvents('org', communityOrgId, { enabled: communityOn });

  const allPosts = useMemo<CommunityPost[]>(
    () => [...(globalPosts.data ?? []), ...(orgPosts.data ?? [])],
    [globalPosts.data, orgPosts.data],
  );

  const recentPosts = useMemo(
    () =>
      [...allPosts]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, RECENT_POSTS),
    [allPosts],
  );

  const upcomingEvents = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return allPosts
      .filter((p) => p.event_date && new Date(p.event_date).getTime() >= startOfToday.getTime())
      .sort((a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime())
      .slice(0, UPCOMING_EVENTS);
  }, [allPosts]);

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

  const { snapshot, level, week, courses, recommended, leaderboard, showLeaderboard } = query.data;

  // Nothing in flight → the hero shows what to start instead of an empty shelf.
  // That is not the same as being brand new: a learner who finished everything
  // keeps their headline and progress bar above the suggestions.
  const heroCourses = courses.length > 0 ? courses : recommended;
  const coursesAreRecommendations = courses.length === 0 && recommended.length > 0;
  const isFresh = snapshot.started === 0;

  // Events are derived from community posts, so they go when community does.
  // With both gone the rail would be a lonely four-row board, so the whole right
  // column drops and the left one takes the full width rather than looking cut off.
  const showRail = showLeaderboard || communityOn;
  const communityLoading = communityOn && (globalPosts.isLoading || orgPosts.isLoading);
  const communityError = communityOn && (globalPosts.isError || orgPosts.isError);

  return (
    <AppLayout>
      <DashboardHero
        name={profile?.first_name || profile?.full_name || null}
        initials={initialsOf(profile?.first_name, profile?.last_name, profile?.full_name)}
        level={level}
        lessonsThisWeek={week.lessons}
        overallPct={snapshot.overallPct}
        courses={heroCourses}
        isFresh={isFresh}
        coursesAreRecommendations={coursesAreRecommendations}
        onCta={() => navigate(isFresh ? routes.learner.courses : routes.learner.training)}
        onCourseClick={(courseId) =>
          navigate(
            coursesAreRecommendations
              ? routes.learner.courseDetail(courseId)
              : routes.learner.coursePlayer(courseId),
          )
        }
      />

      <div className={showRail ? 'grid items-start gap-[26px] lg:grid-cols-[62%_minmax(0,1fr)]' : ''}>
        <div className="min-w-0">
          <DashboardStats snapshot={snapshot} week={week} />

          {communityOn &&
            (communityLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : communityError ? (
              <div className="mt-[30px]">
                <QueryErrorState
                  onRetry={() => {
                    globalPosts.refetch();
                    orgPosts.refetch();
                  }}
                />
              </div>
            ) : (
              <DashboardCommunity
                posts={recentPosts}
                onPostClick={(post) => navigate(routes.community.postDetail(post.scope, post.id))}
                onSeeMore={() => navigate(routes.community.feed)}
              />
            ))}
        </div>

        {showRail && (
          // Hairline in the gutter — the columns are told apart by the rule
          // alone, with no change of plane. It only exists once they sit
          // side by side; stacked, the sections read in order.
          <div className="min-w-0 self-stretch lg:border-l lg:border-[rgba(23,26,38,0.09)] lg:pl-[26px]">
            {/* Server decides visibility: false for the individual tier (#354) and for a
                per-org leaderboard opt-out (#369). Hides the widget entirely rather than
                rendering an empty board for a disabled feature. */}
            {showLeaderboard && <DashboardLeaderboard leaderboard={leaderboard.allTime} />}

            {communityOn && !communityLoading && !communityError && (
              <DashboardEvents
                events={upcomingEvents}
                onEventClick={(event) => navigate(routes.community.postDetail(event.scope, event.id))}
                onSeeMore={() => navigate(routes.community.events)}
              />
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
