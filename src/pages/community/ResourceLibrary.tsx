import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
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
import { ResourceCard } from '@/components/community/ResourceCard';
import { ResourceForm } from '@/components/community/ResourceForm';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useAuth } from '@/hooks/useAuth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { toast } from '@/components/ui/sonner';
import {
  fetchResources,
  createResource,
  updateResource,
  deleteResource,
  toggleResourcePinned,
  RESOURCE_TYPES,
  type CommunityResource,
} from '@/lib/resources-api';
import {
  ArrowLeft,
  Search,
  Plus,
  Loader2,
} from 'lucide-react';

export default function ResourceLibrary() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentOrg, profile, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const orgGuard = useOrgGuard();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingResource, setEditingResource] = useState<CommunityResource | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CommunityResource | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  // The input binds the raw value (stays responsive); the query key gets the
  // debounced one, so typing fires ~one request per pause, not per keystroke (#41).
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  const isAdmin = effectiveIsOrgAdmin || effectiveIsPlatformAdmin;

  // Single fetch: filtered resources for display + the org's distinct tags for the dropdown.
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.communityResources.list(currentOrg?.id, debouncedSearch, selectedType, selectedTag),
    queryFn: () =>
      fetchResources(currentOrg!.id, {
        search: debouncedSearch || undefined,
        resource_type: selectedType || undefined,
        tags: selectedTag ? [selectedTag] : undefined,
      }),
    enabled: !!currentOrg,
  });
  const resources = data?.resources ?? [];
  const allTags = data?.allTags ?? [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Omit<Parameters<typeof createResource>[0], 'org_id'>) =>
      createResource({
        ...data,
        org_id: currentOrg!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityResources.all });
      toast({ title: t('community.toasts.resourceAdded') });
    },
    onError: (error: Error) => {
      toast({ title: t('community.toasts.resourceAddFailed'), description: error.message, variant: 'destructive' });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateResource>[1] }) =>
      updateResource(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityResources.all });
      toast({ title: t('community.toasts.resourceUpdated') });
      setEditingResource(null);
    },
    onError: (error: Error) => {
      toast({ title: t('community.toasts.resourceUpdateFailed'), description: error.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteResource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityResources.all });
      toast({ title: t('community.toasts.resourceDeleted') });
      setDeleteConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: t('community.toasts.resourceDeleteFailed'), description: error.message, variant: 'destructive' });
    },
  });

  // Pin toggle mutation
  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      toggleResourcePinned(id, pinned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityResources.all });
    },
  });

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
          <p className="text-sm text-muted-foreground">{t('community.noOrgResources')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={[{ label: t('community.title'), hrefKey: 'community' }, { label: t('community.resources') }]}>
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
            {t('community.resourceLibrary')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('community.resourceLibrarySubtitle', { orgName: currentOrg.name })}
          </p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="h-auto whitespace-nowrap rounded-[11px] px-4 py-2.5 text-[13px] font-bold"
        >
          <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
          {t('community.addResource')}
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-2.5 md:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            placeholder={t('community.searchResources')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-auto rounded-xl py-[11px] pl-10 pr-3.5 text-[13.5px] md:text-[13.5px]"
          />
        </div>
        <Select
          value={selectedType || 'all'}
          onValueChange={(v) => setSelectedType(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="h-auto w-full rounded-xl py-[11px] text-[13px] font-semibold md:w-[160px]">
            <SelectValue placeholder={t('community.allTypes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('community.allTypes')}</SelectItem>
            {RESOURCE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select
            value={selectedTag || 'all'}
            onValueChange={(v) => setSelectedTag(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="h-auto w-full rounded-xl py-[11px] text-[13px] font-semibold md:w-[160px]">
              <SelectValue placeholder={t('community.allTagsFilter')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('community.allTagsFilter')}</SelectItem>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  #{tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Resources grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : resources.length === 0 ? (
        <CommunityEmptyState
          variant="resources"
          onAction={() => setShowForm(true)}
          actionLabel={t('community.addFirstResource')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {resources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              isOwner={resource.user_id === profile?.id}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditingResource(resource);
                setShowForm(true);
              }}
              onDelete={() => setDeleteConfirm(resource)}
              onTogglePin={(pinned) => pinMutation.mutate({ id: resource.id, pinned })}
            />
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      <ResourceForm
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingResource(null);
        }}
        editResource={editingResource}
        onSubmit={async (data) => {
          if (editingResource) {
            await updateMutation.mutateAsync({ id: editingResource.id, data });
          } else {
            await createMutation.mutateAsync(data);
          }
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('community.deleteResourceTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('community.deleteResourceDescription', { title: deleteConfirm?.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
