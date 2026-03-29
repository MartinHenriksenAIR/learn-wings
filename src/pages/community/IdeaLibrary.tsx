import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IdeaCard } from '@/components/community/IdeaCard';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { useAuth } from '@/hooks/useAuth';
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
} from 'lucide-react';
import { toast } from 'sonner';

export default function IdeaLibrary() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { currentOrg, user, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
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

  // Status filters per tab
  const tabStatusFilters: Record<string, IdeaStatusExtended[]> = {
    all: [],
    drafts: ['draft'],
    submitted: ['submitted', 'in_review'],
    approved: ['accepted', 'in_progress', 'done'],
    rejected: ['rejected'],
  };

  // Fetch ideas - for drafts tab, filter by current user
  const { data: ideas = [], isLoading } = useQuery({
    queryKey: ['ideas', currentOrg?.id, safeTab, searchQuery, selectedBusinessArea, selectedTags, user?.id],
    queryFn: () => fetchIdeas(currentOrg!.id, {
      status: tabStatusFilters[safeTab].length > 0 ? tabStatusFilters[safeTab] : undefined,
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      user_id: safeTab === 'drafts' ? user?.id : undefined,
    }),
    enabled: !!currentOrg,
  });

  const { data: orgTags = [] } = useQuery({
    queryKey: ['idea-tags', currentOrg?.id],
    queryFn: () => fetchOrgTags(currentOrg!.id),
    enabled: !!currentOrg,
  });

  // Delete idea mutation
  const deleteMutation = useMutation({
    mutationFn: deleteIdea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      toast.success('Idea deleted successfully');
    },
    onError: (error) => {
      toast.error('Failed to delete idea');
      console.error('Delete error:', error);
    },
  });

  // Filter out drafts for non-owners in the library view (except in drafts tab)
  const filteredIdeas = safeTab === 'all' 
    ? ideas.filter((i) => i.status !== 'draft')
    : safeTab === 'drafts'
    ? ideas.filter((i) => i.user_id === user?.id) // Extra safety check
    : ideas;

  const hasActiveFilters = Boolean(searchQuery || selectedBusinessArea || selectedTags.length > 0);

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (!currentOrg) {
    return (
      <AppLayout>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">No Organization Selected</h1>
          <p className="text-muted-foreground">Please select an organization to view ideas.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Idea Library" breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }]}>
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
              <h1 className="text-2xl font-bold">Idea Library</h1>
              <p className="text-muted-foreground">
                Browse AI and process improvement ideas from {currentOrg.name}
              </p>
            </div>
          </div>
          <Button onClick={() => navigate('/app/community/org/ideas/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Submit Idea
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={safeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="all">All Ideas</TabsTrigger>
            <TabsTrigger value="drafts" className="gap-1">
              <FileEdit className="h-3 w-3" />
              My Drafts
            </TabsTrigger>
            {isAdmin && <TabsTrigger value="submitted">Under Review</TabsTrigger>}
            {isAdmin && <TabsTrigger value="approved">Approved</TabsTrigger>}
            {isAdmin && <TabsTrigger value="rejected">Rejected</TabsTrigger>}
          </TabsList>
        </Tabs>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search ideas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={selectedBusinessArea || 'all'}
                onValueChange={(v) => setSelectedBusinessArea(v === 'all' ? '' : v)}
              >
                <SelectTrigger className="w-full md:w-[200px]">
                  <SelectValue placeholder="All business areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All business areas</SelectItem>
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
                <SelectTrigger className="w-full md:w-[220px]">
                  <SelectValue placeholder="Filter by tags" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_tags">Filter by tags</SelectItem>
                  {orgTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedTags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <Button
                    key={tag}
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                  >
                    {tag} ×
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ideas grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredIdeas.length === 0 ? (
          <CommunityEmptyState
            variant={safeTab === 'drafts' ? 'drafts' : 'ideas'}
            onAction={() => navigate('/app/community/org/ideas/new')}
            actionLabel={safeTab === 'drafts' ? 'Start New Idea' : 'Submit First Idea'}
            hasActiveFilters={hasActiveFilters}
            filterDescription="No ideas match your current filters."
            onClearFilters={() => {
              setSearchQuery('');
              setSelectedBusinessArea('');
              setSelectedTags([]);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onClick={() => {
                  // Drafts go to edit mode, other ideas go to detail view
                  if (idea.status === 'draft') {
                    navigate(`/app/community/org/ideas/edit/${idea.id}`);
                  } else {
                    navigate(`/app/community/org/ideas/${idea.id}`);
                  }
                }}
                onDelete={() => deleteMutation.mutate(idea.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
