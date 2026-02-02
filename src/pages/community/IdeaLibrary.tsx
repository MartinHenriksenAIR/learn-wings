import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IdeaCard } from '@/components/community/IdeaCard';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { useAuth } from '@/hooks/useAuth';
import { fetchIdeas, deleteIdea } from '@/lib/ideas-api';
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
  const queryClient = useQueryClient();
  const { currentOrg, user } = useAuth();

  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBusinessArea, setSelectedBusinessArea] = useState<string>('');

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
    queryKey: ['ideas', currentOrg?.id, activeTab, searchQuery, selectedBusinessArea, user?.id],
    queryFn: () => fetchIdeas(currentOrg!.id, {
      status: tabStatusFilters[activeTab].length > 0 ? tabStatusFilters[activeTab] : undefined,
      search: searchQuery || undefined,
      business_area: selectedBusinessArea ? [selectedBusinessArea as BusinessArea] : undefined,
      user_id: activeTab === 'drafts' ? user?.id : undefined,
    }),
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
  const filteredIdeas = activeTab === 'all' 
    ? ideas.filter((i) => i.status !== 'draft')
    : activeTab === 'drafts'
    ? ideas.filter((i) => i.user_id === user?.id) // Extra safety check
    : ideas;

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
    <AppLayout>
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList>
            <TabsTrigger value="all">All Ideas</TabsTrigger>
            <TabsTrigger value="drafts" className="gap-1">
              <FileEdit className="h-3 w-3" />
              My Drafts
            </TabsTrigger>
            <TabsTrigger value="submitted">Under Review</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
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
            </div>
          </CardContent>
        </Card>

        {/* Ideas grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredIdeas.length === 0 ? (
          <CommunityEmptyState
            variant={activeTab === 'drafts' ? 'drafts' : 'ideas'}
            onAction={() => navigate('/app/community/org/ideas/new')}
            actionLabel={activeTab === 'drafts' ? 'Start New Idea' : 'Submit First Idea'}
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
