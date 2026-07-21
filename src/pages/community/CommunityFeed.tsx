import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { PostCard } from '@/components/community/PostCard';
import { PostForm } from '@/components/community/PostForm';
import { UpcomingEvents } from '@/components/community/UpcomingEvents';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { AIChampionsList } from '@/components/community/AIChampionsList';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  fetchCategories,
  fetchPosts,
  createPost,
  togglePostHidden,
  togglePostLocked,
} from '@/lib/community-api';
import {
  Plus,
  Search,
  Lightbulb,
  Globe,
  Building2,
  Loader2,
  Lock,
  X,
  FolderOpen,
  ChevronRight,
} from 'lucide-react';
import type { CommunityScope, CommunityPost } from '@/lib/community-types';

export default function CommunityFeed() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, currentOrg, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const scopeParam = searchParams.get('scope') as CommunityScope | null;
  const scope: CommunityScope = scopeParam === 'global' ? 'global' : 'org';

  const [showPostForm, setShowPostForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Redirect to global if no org
  useEffect(() => {
    if (scope === 'org' && !currentOrg) {
      setSearchParams({ scope: 'global' });
    }
  }, [scope, currentOrg, setSearchParams]);

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.communityCategories.all,
    queryFn: fetchCategories,
  });

  // Fetch posts
  const { data: posts = [], isLoading } = useQuery({
    queryKey: queryKeys.communityPosts.list(scope, currentOrg?.id, selectedCategory, searchQuery, selectedTags),
    queryFn: () => fetchPosts({
      scope,
      org_id: scope === 'org' ? currentOrg?.id : undefined,
      category_id: selectedCategory || undefined,
      search: searchQuery || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
    }),
    enabled: scope === 'global' || !!currentOrg,
  });

  // Create post mutation
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

  // Admin actions
  const toggleHideMutation = useMutation({
    mutationFn: ({ postId, hidden }: { postId: string; hidden: boolean }) =>
      togglePostHidden(postId, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityPosts.all });
    },
  });

  const toggleLockMutation = useMutation({
    mutationFn: ({ postId, locked }: { postId: string; locked: boolean }) =>
      togglePostLocked(postId, locked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityPosts.all });
    },
  });

  const canPostRestricted = scope === 'global'
    ? effectiveIsPlatformAdmin
    : effectiveIsOrgAdmin || effectiveIsPlatformAdmin;

  const isAdmin = scope === 'global'
    ? effectiveIsPlatformAdmin
    : effectiveIsOrgAdmin || effectiveIsPlatformAdmin;

  // Filter event posts for the widget
  const eventPosts = posts.filter((p) => p.category?.slug === 'events');

  // Get all unique tags from posts
  const allTags = [...new Set(posts.flatMap((p) => p.tags || []))];
  const hasActiveFilters = Boolean(searchQuery || selectedCategory || selectedTags.length > 0);

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to={routes.learner.dashboard} replace />;
  }

  const scopeTabs = [
    ...(currentOrg
      ? [{ key: 'org', label: currentOrg.name, icon: <Building2 aria-hidden="true" className="h-3.5 w-3.5" /> }]
      : []),
    { key: 'global', label: t('community.globalCommunity'), icon: <Globe aria-hidden="true" className="h-3.5 w-3.5" /> },
    {
      key: 'events_coming_soon',
      label: <span title={t('community.comingSoon')}>{t('community.eventsOfficeHours')}</span>,
      disabled: true,
    },
  ];

  return (
    <AppLayout breadcrumbs={[{ label: t('community.title') }]}> {/* single crumb: page itself, no default href needed */}
      {/* Header */}
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {scope === 'org'
              ? t('community.subtitleOrg', { orgName: currentOrg?.name || t('nav.organization') })
              : t('community.subtitleGlobal')}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {scope === 'org' && (
            <Button
              variant="outline"
              onClick={() => navigate(routes.community.ideaNew)}
              className="group h-auto whitespace-nowrap rounded-[11px] border-[#dcdee6] bg-card px-4 py-2.5 text-[13px] font-bold text-[#2a2d3a] hover:border-primary hover:bg-card hover:text-primary"
            >
              <Lightbulb aria-hidden="true" className="h-[15px] w-[15px] group-hover:animate-bulb-wiggle" />
              {t('community.submitIdea')}
            </Button>
          )}
          <Button
            onClick={() => setShowPostForm(true)}
            className="h-auto whitespace-nowrap rounded-[11px] px-4 py-2.5 text-[13px] font-bold"
          >
            <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
            {t('community.newPost')}
          </Button>
        </div>
      </div>

      {/* Scope tabs */}
      <SlidingTabs
        tabs={scopeTabs}
        active={scope}
        onChange={(key) => setSearchParams({ scope: key as CommunityScope })}
        className="mb-5"
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]">
        {/* Main content */}
        <div className="flex flex-col gap-3.5">
          {/* Search and category chips */}
          <div className="flex flex-col gap-[13px] rounded-2xl border border-border bg-card px-[18px] py-4">
            {/* Search bar */}
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
              <Input
                placeholder={t('community.searchPosts')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-auto rounded-[11px] py-2.5 pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
              />
            </div>

            {/* Category chips */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[7px] border px-3.5 py-[7px] text-[12.5px] font-bold',
                  !selectedCategory
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card text-[#4a4f60] hover:opacity-85'
                )}
              >
                {t('common.all')}
              </button>
              {categories.filter((cat) => cat.slug !== 'events').map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id === selectedCategory ? '' : cat.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-[7px] border px-3.5 py-[7px] text-[12.5px] font-bold',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-card text-[#4a4f60] hover:opacity-85'
                    )}
                  >
                    {cat.name}
                    {cat.is_restricted && <Lock aria-label={t('community.locked')} className="h-[11px] w-[11px]" />}
                  </button>
                );
              })}
            </div>

            {/* Active tag filters */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-muted-foreground">{t('community.tagsLabel')}</span>
                {selectedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTags((t) => t.filter((x) => x !== tag))}
                    className="inline-flex items-center gap-1 rounded-[7px] bg-accent px-2.5 py-[3px] text-[11.5px] font-semibold text-accent-foreground hover:opacity-85"
                  >
                    #{tag}
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedTags([])}
                  className="rounded-lg px-1.5 py-[3px] text-[11.5px] font-semibold text-muted-foreground hover:text-primary"
                >
                  {t('community.clearTags')}
                </button>
              </div>
            )}
          </div>

          {/* Posts list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 ? (
            <CommunityEmptyState
              variant="posts"
              onAction={() => setShowPostForm(true)}
              actionLabel={t('community.createFirstPost')}
              hasActiveFilters={hasActiveFilters}
              filterDescription={t('community.noPostsMatchFilters')}
              onClearFilters={() => {
                setSearchQuery('');
                setSelectedCategory('');
                setSelectedTags([]);
              }}
            />
          ) : (
            <div className="flex flex-col gap-3.5">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onClick={() => navigate(routes.community.postDetail(scope, post.id))}
                  isAdmin={isAdmin}
                  onToggleHide={isAdmin ? (id, hidden) => toggleHideMutation.mutate({ postId: id, hidden }) : undefined}
                  onToggleLock={isAdmin ? (id, locked) => toggleLockMutation.mutate({ postId: id, locked }) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3.5">
          {/* Upcoming Events */}
          {eventPosts.length > 0 && (
            <UpcomingEvents
              events={eventPosts}
              onEventClick={(event: CommunityPost) => navigate(routes.community.postDetail(scope, event.id))}
            />
          )}

          {/* Libraries (org only) */}
          {scope === 'org' && currentOrg && (
            <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-5 py-[18px]">
              <h3 className="mb-2 text-[13.5px] font-extrabold">{t('community.libraries')}</h3>
              <button
                type="button"
                onClick={() => navigate(routes.community.ideas)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-[13px] font-bold text-[#2a2d3a] hover:bg-muted/60"
              >
                <Lightbulb aria-hidden="true" className="h-[15px] w-[15px] text-warning" />
                {t('community.ideaLibrary')}
                <ChevronRight aria-hidden="true" className="ml-auto h-[13px] w-[13px] text-[#c3c7d3]" />
              </button>
              <button
                type="button"
                onClick={() => navigate(routes.community.resources)}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-[9px] text-left text-[13px] font-bold text-[#2a2d3a] hover:bg-muted/60"
              >
                <FolderOpen aria-hidden="true" className="h-[15px] w-[15px] text-primary" />
                {t('community.resourceLibrary')}
                <ChevronRight aria-hidden="true" className="ml-auto h-[13px] w-[13px] text-[#c3c7d3]" />
              </button>
            </div>
          )}

          {/* AI Champions (org only) */}
          {scope === 'org' && currentOrg && (
            <AIChampionsList orgId={currentOrg.id} />
          )}

          {/* Popular tags */}
          {allTags.length > 0 && (
            <div className="rounded-2xl border border-border bg-card px-5 py-[18px]">
              <h3 className="mb-3 text-[13.5px] font-extrabold">{t('community.popularTags')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {allTags.slice(0, 10).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setSelectedTags((t) =>
                        t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]
                      )
                    }
                    className={cn(
                      'rounded-[7px] px-2.5 py-[3px] text-[11.5px] font-semibold',
                      selectedTags.includes(tag)
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-accent text-accent-foreground hover:opacity-85'
                    )}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Post form dialog */}
      <PostForm
        open={showPostForm}
        onOpenChange={setShowPostForm}
        onSubmit={async (data) => {
          await createPostMutation.mutateAsync(data);
        }}
        categories={categories}
        scope={scope}
        orgId={currentOrg?.id}
        canPostRestricted={canPostRestricted}
      />
    </AppLayout>
  );
}
