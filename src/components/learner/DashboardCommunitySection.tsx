import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Loader2, MessageSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { PostCard } from '@/components/community/PostCard';
import { UpcomingEvents } from '@/components/community/UpcomingEvents';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import { routes } from '@/lib/routes';
import type { CommunityPost } from '@/lib/community-types';

const RECENT_POSTS_LIMIT = 4;

/**
 * Community glance on the learner dashboard (#343): a preview of recent posts
 * plus the shared UpcomingEvents card, with a "View all" link into the feed.
 *
 * Mounted only when `useCommunityGate` reports the feature enabled (the parent
 * gates), so its queries stay idle when community is off. Reuses the
 * community-posts reader (`useCommunityEvents`, which returns every post for a
 * scope) for both derivations — the recent-activity sort and the events cut
 * share one cached request per scope.
 */
export function DashboardCommunitySection({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const globalQuery = useCommunityEvents('global', orgId);
  const orgQuery = useCommunityEvents('org', orgId);

  const isLoading = globalQuery.isLoading || orgQuery.isLoading;
  const isError = globalQuery.isError || orgQuery.isError;

  const allPosts = useMemo<CommunityPost[]>(
    () => [...(globalQuery.data ?? []), ...(orgQuery.data ?? [])],
    [globalQuery.data, orgQuery.data],
  );

  const recentPosts = useMemo(
    () =>
      [...allPosts]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, RECENT_POSTS_LIMIT),
    [allPosts],
  );

  return (
    <div className="mb-8">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="font-display text-[17px] font-bold">{t('dashboard.community.title')}</h2>
        <Button asChild variant="ghost" size="sm" className="text-[13px] font-bold text-primary hover:text-primary">
          <Link to={routes.community.feed}>
            {t('dashboard.community.viewAll')}
            <ArrowRight aria-hidden="true" className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <QueryErrorState
          onRetry={() => {
            globalQuery.refetch();
            orgQuery.refetch();
          }}
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-extrabold">
              <MessageSquare aria-hidden="true" className="h-[15px] w-[15px] text-primary" />
              {t('dashboard.community.recentActivity')}
            </h3>
            {recentPosts.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title={t('dashboard.community.noActivityTitle')}
                description={t('dashboard.community.noActivityDescription')}
              />
            ) : (
              <div className="flex flex-col gap-3.5">
                {recentPosts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onClick={() => navigate(routes.community.postDetail(post.scope, post.id))}
                  />
                ))}
              </div>
            )}
          </div>
          <div>
            <UpcomingEvents
              events={allPosts}
              onEventClick={(event) => navigate(routes.community.postDetail(event.scope, event.id))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
