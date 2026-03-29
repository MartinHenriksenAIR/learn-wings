import { useState, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuth } from '@/hooks/useAuth';
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
  FolderOpen,
} from 'lucide-react';

export default function ResourceLibrary() {
  const navigate = useNavigate();
  const { currentOrg, user, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editingResource, setEditingResource] = useState<CommunityResource | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CommunityResource | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const isAdmin = effectiveIsOrgAdmin || effectiveIsPlatformAdmin;

  // Fetch all resources (for tag extraction)
  const { data: allResources = [] } = useQuery({
    queryKey: ['community-resources-all', currentOrg?.id],
    queryFn: () => fetchResources(currentOrg!.id),
    enabled: !!currentOrg,
  });

  // Unique tags from all resources
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    allResources.forEach((r) => r.tags?.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [allResources]);

  // Fetch filtered resources
  const { data: resources = [], isLoading } = useQuery({
    queryKey: ['community-resources', currentOrg?.id, searchQuery, selectedType, selectedTag],
    queryFn: () =>
      fetchResources(currentOrg!.id, {
        search: searchQuery || undefined,
        resource_type: selectedType || undefined,
        tags: selectedTag ? [selectedTag] : undefined,
      }),
    enabled: !!currentOrg,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Omit<Parameters<typeof createResource>[0], 'org_id' | 'user_id'>) =>
      createResource({
        ...data,
        org_id: currentOrg!.id,
        user_id: user!.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-resources'] });
      toast({ title: 'Resource added successfully!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to add resource', description: error.message, variant: 'destructive' });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateResource>[1] }) =>
      updateResource(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-resources'] });
      toast({ title: 'Resource updated!' });
      setEditingResource(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update resource', description: error.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteResource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-resources'] });
      toast({ title: 'Resource deleted' });
      setDeleteConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete resource', description: error.message, variant: 'destructive' });
    },
  });

  // Pin toggle mutation
  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      toggleResourcePinned(id, pinned),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-resources'] });
    },
  });

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">No Organization Selected</h1>
          <p className="text-muted-foreground">Please select an organization to view resources.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Resource Library" breadcrumbs={[{ label: 'Community' }, { label: 'Resources' }]}>
      <div className="container mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/app/community?scope=org')}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <FolderOpen className="h-6 w-6" />
                Resource Library
              </h1>
              <p className="text-muted-foreground">
                Helpful resources, templates, and guides from {currentOrg.name}
              </p>
            </div>
          </div>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Resource
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search resources..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={selectedType || 'all'}
                onValueChange={(v) => setSelectedType(v === 'all' ? '' : v)}
              >
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
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
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="All tags" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tags</SelectItem>
                    {allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        #{tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Resources grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : resources.length === 0 ? (
          <CommunityEmptyState
            variant="resources"
            onAction={() => setShowForm(true)}
            actionLabel="Add First Resource"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                isOwner={resource.user_id === user?.id}
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
              <AlertDialogTitle>Delete Resource?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deleteConfirm?.title}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
