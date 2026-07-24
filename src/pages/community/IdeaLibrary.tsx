import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { IdeaCard } from '@/components/community/IdeaCard';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QueryErrorState } from '@/components/ui/query-error-state';
import { useQueryErrorToast } from '@/components/platform-admin/org-detail/useQueryErrorToast';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { fetchIdeas, deleteIdea, fetchOrgTags } from '@/lib/ideas-api';
import { BUSINESS_AREAS } from '@/lib/community-types';
import type { IdeaStatusExtended, BusinessArea } from '@/lib/community-types';
import {
  ArrowLeft,
  Search,
  Plus,
  Loader2,
  FileEdit,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

export default function IdeaLibrary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  // profile.id (DB row UUID) is the ownership identity — user.id is the Entra OID
  // and never matches ideas.user_id post-migration.
  const { currentOrg, profile, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { features, isLoading: settingsLoading } = usePlatformSettings();

  const initialTab = searchParams.get('tab') || 'all';
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBusinessArea, setSelectedBusinessArea] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPickerValue, setTagPickerValue] = useState('all_tags');

  const isAdmin = effectiveIsOrgAdmin || effectiveIsPlatformAdmin;
  const visibleTabs = useMemo(
    () => (isAdmin ? ['all', 'drafts', 'submitted', 'approved', 'rejected'] : ['all', 'drafts']),
    [isAdmin]
  );
  const safeTab = visibleTabs.includes(activeTab) ? activeTab : 'all';

  const ideaTabs = useMemo(
    () => [
      { key: 'all', label: t('community.allIdeas') },
      {
        key: 'drafts',
        label: t('community.myDrafts'),
        icon: <FileEdit aria-hidden="true" className="h-3 w-3" />,
      },
      ...(isAdmin
        ? [
            { key: 'submitted', label: t('community.underReview') },
            { key: 'approved', label: t('community.approved') },
            { key: 'rejected', label: t('community.rejected') },
          ]
        : []),
    ],
    [isAdmin, t]
  );

  // Status filters per tab
  const tabStatusFilters: Record<string, IdeaStatusExtended[]> = {
    all: [],
    drafts: ['draft'],
    submitted: ['submitted', 'in_review'],
    approved: ['accepted', 'in_progress', 'done'],
    rejected: ['rejected'],
  };

  // Fetch ideas - for drafts tab, filter by current user (primary data)
  const { data: ideas = [], isLoading, isError: ideasError, refetch: refetchIdeas } = useQuery({
    queryKey: queryKeys.ideas.list(currentOrg?.id, safeTab, searchQuery, selectedBusinessArea, selectedTags, profile?.id),
    queryFn: () => fetchIdeas(currentOrg!.id, {
      status: tabStatusFilters[safeTab].length > 0 ? tabStatusFilters[safeTab] : undefined,
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      user_id: safeTab === 'drafts' ? profile?.id : undefined,
    }),
    enabled: !!currentOrg,
  });

  // Org tags are secondary (the tag filter dropdown) — a failure degrades the
  // filter but should not blank the page, so it toasts + logs instead.
  const { data: orgTags = [], isError: orgTagsError, error: orgTagsErrorObj } = useQuery({
    queryKey: queryKeys.ideaTags.list(currentOrg?.id),
    queryFn: () => fetchOrgTags(currentOrg!.id),
    enabled: !!currentOrg,
  });
  useQueryErrorToast({
    isError: orgTagsError,
    error: orgTagsErrorObj,
    toastTitle: t('common.loadErrorTitle'),
    logLabel: 'IdeaLibrary: failed to load org tags',
  });

  // Delete idea mutation
  const deleteMutation = useMutation({
    mutationFn: deleteIdea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ideas.all });
      toast.success(t('community.toasts.ideaDeleted'));
    },
    onError: (error) => {
      toast.error(t('community.toasts.ideaDeleteFailed'));
      console.error('Delete error:', error);
    },
  });

  // Filter out drafts for non-owners in the library view (except in drafts tab)
  const filteredIdeas = safeTab === 'all'
    ? ideas.filter((i) => i.status !== 'draft')
    : safeTab === 'drafts'
    ? ideas.filter((i) => i.user_id === profile?.id) // Extra safety check
    : ideas;

  const hasActiveFilters = Boolean(searchQuery || selectedBusinessArea || selectedTags.length > 0);

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to={routes.learner.dashboard} replace />;
  }

  // Profile-gated guard (useOrgGuard): don't flash "No Organization Selected"
  // while the signed-in user's context is still resolving.
  if (orgGuard === 'loading') {
    return (
      <AppLayout>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="py-12 text-center">
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.noOrganizationTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('community.noOrgIdeas')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={[{ label: t('community.title'), hrefKey: 'community' }, { label: t('community.ideaLibrary') }]}>
      {/* Back to community */}
      <Button
        variant="ghost"
        onClick={() => navigate(`${routes.community.feed}?scope=org`)}
        className="mb-3.5 h-auto rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground hover:bg-transparent hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        {t('community.backToCommunity')}
      </Button>

      {/* Header */}
      <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.ideaLibrary')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('community.ideaLibrarySubtitle', { orgName: currentOrg.name })}
          </p>
        </div>
        <Button
          onClick={() => navigate(routes.community.ideaNew)}
          className="group h-auto whitespace-nowrap rounded-[11px] px-4 py-2.5 text-[13px] font-bold"
        >
          <Plus aria-hidden="true" className="h-[15px] w-[15px] group-hover:animate-bulb-wiggle" />
          {t('community.submitIdea')}
        </Button>
      </div>

      {/* Tabs */}
      <SlidingTabs tabs={ideaTabs} active={safeTab} onChange={setActiveTab} className="mb-[18px]" />

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-2.5 md:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            placeholder={t('community.searchIdeas')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-auto rounded-xl py-[11px] pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
          />
        </div>
        <Select
          value={selectedBusinessArea || 'all'}
          onValueChange={(v) => setSelectedBusinessArea(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="h-auto w-full rounded-xl py-[11px] text-[13px] font-semibold md:w-[200px]">
            <SelectValue placeholder={t('community.allBusinessAreas')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('community.allBusinessAreas')}</SelectItem>
            {BUSINESS_AREAS.map((area) => (
              <SelectItem key={area.value} value={area.value}>
                {area.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={tagPickerValue}
          onValueChange={(tag) => {
            if (tag !== 'all_tags' && !selectedTags.includes(tag)) {
              setSelectedTags((prev) => [...prev, tag]);
            }
            setTagPickerValue('all_tags');
          }}
        >
          <SelectTrigger className="h-auto w-full rounded-xl py-[11px] text-[13px] font-semibold md:w-[200px]">
            <SelectValue placeholder={t('community.filterByTags')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_tags">{t('community.filterByTags')}</SelectItem>
            {orgTags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Active tag filters */}
      {selectedTags.length > 0 && (
        <div className="mb-5 -mt-2 flex flex-wrap items-center gap-2">
          {selectedTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTags((prev) => prev.filter((x) => x !== tag))}
              className="inline-flex items-center gap-1 rounded-[7px] bg-accent px-2.5 py-[3px] text-[11.5px] font-semibold text-accent-foreground hover:opacity-85"
            >
              #{tag}
              <X aria-hidden="true" className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {/* Ideas grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : ideasError ? (
        // A failed fetch must not render the "no ideas yet" empty state.
        <QueryErrorState onRetry={() => refetchIdeas()} />
      ) : filteredIdeas.length === 0 ? (
        <CommunityEmptyState
          variant={safeTab === 'drafts' ? 'drafts' : 'ideas'}
          onAction={() => navigate(routes.community.ideaNew)}
          actionLabel={safeTab === 'drafts' ? t('community.startNewIdea') : t('community.submitFirstIdea')}
          hasActiveFilters={hasActiveFilters}
          filterDescription={t('community.noIdeasMatchFilters')}
          onClearFilters={() => {
            setSearchQuery('');
            setSelectedBusinessArea('');
            setSelectedTags([]);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {filteredIdeas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onClick={() => {
                // Drafts go to edit mode, other ideas go to detail view
                if (idea.status === 'draft') {
                  navigate(routes.community.ideaEdit(idea.id));
                } else {
                  navigate(routes.community.ideaDetail(idea.id));
                }
              }}
              onDelete={() => deleteMutation.mutate(idea.id)}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}
