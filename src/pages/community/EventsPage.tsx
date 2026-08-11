import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { PostForm } from '@/components/community/PostForm';
import { EventsTab } from '@/pages/community/EventsTab';
import { useAuth } from '@/hooks/useAuth';
import { useCommunityGate } from '@/hooks/useCommunityGate';
import { toast } from '@/components/ui/sonner';
import { fetchCategories, createPost } from '@/lib/community-api';
import { Plus } from 'lucide-react';
import type { CommunityScope } from '@/lib/community-types';

/**
 * Events & Office Hours — a standalone top-level destination (#344). It was a
 * tab inside the community feed; now it's its own page in the Fællesskab group,
 * community-gated like the feed. The upcoming-events list is the reusable
 * EventsTab body; this page supplies the page chrome and the admin-only
 * event-creation flow (moved off the feed header).
 */
export default function EventsPage() {
  const { t } = useTranslation();
  const { currentOrg, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const communityGate = useCommunityGate();
  const queryClient = useQueryClient();

  const [showPostForm, setShowPostForm] = useState(false);

  // #354: the hidden Individuals placeholder is not a real org — an org admin
  // there posts nothing org-scoped; identity reads stay on the real currentOrg.
  const orgForEvents = currentOrg?.kind === 'individual' ? null : currentOrg;

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.communityCategories.all,
    queryFn: fetchCategories,
  });

  const createPostMutation = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityPosts.all });
      toast({ title: t('community.toasts.postCreated') });
    },
    onError: (error: Error) => {
      toast({ title: t('community.toasts.postCreateFailed'), description: error.message, variant: 'destructive' });
    },
  });

  // Admin-only creation: platform admins post events globally; org admins post
  // to their current org. Learners get no create affordance.
  const canCreateEvent = effectiveIsPlatformAdmin || effectiveIsOrgAdmin;
  const eventScope: CommunityScope = effectiveIsPlatformAdmin ? 'global' : 'org';
  const eventsCategoryId = categories.find((c) => c.slug === 'events')?.id;
  // Fresh literal each render would re-reset the form; memoize so it's stable.
  const eventInitialData = useMemo(
    () => (eventsCategoryId ? { category_id: eventsCategoryId } : undefined),
    [eventsCategoryId],
  );

  if (communityGate === 'redirect') return <Navigate to={routes.learner.dashboard} replace />;

  return (
    <AppLayout breadcrumbs={[{ label: t('community.events') }]}>
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.events')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('community.eventsSubtitle')}</p>
        </div>
        {canCreateEvent && (
          <Button
            onClick={() => setShowPostForm(true)}
            className="h-auto whitespace-nowrap rounded-[11px] px-4 py-2.5 text-[13px] font-bold"
          >
            <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
            {t('community.newEvent')}
          </Button>
        )}
      </div>

      <EventsTab canCreateEvent={canCreateEvent} onNewEvent={() => setShowPostForm(true)} />

      {/* Post form dialog: opens with the events category preselected and posts
          at the admin's event scope (global for platform admins, current org
          for org admins). */}
      <PostForm
        open={showPostForm}
        onOpenChange={setShowPostForm}
        onSubmit={async (data) => {
          await createPostMutation.mutateAsync(data);
        }}
        categories={categories}
        scope={eventScope}
        orgId={orgForEvents?.id}
        canPostRestricted={canCreateEvent}
        initialData={eventInitialData}
      />
    </AppLayout>
  );
}
