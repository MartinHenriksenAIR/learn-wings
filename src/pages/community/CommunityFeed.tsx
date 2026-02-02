import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PostCard } from '@/components/community/PostCard';
import { PostForm } from '@/components/community/PostForm';
import { UpcomingEvents } from '@/components/community/UpcomingEvents';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { CategoryBadge } from '@/components/community/CategoryBadge';
import { AIChampionsList } from '@/components/community/AIChampionsList';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
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
  X,
} from 'lucide-react';
import type { CommunityScope, CommunityCategory, CommunityPost } from '@/lib/community-types';

export default function CommunityFeed() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, currentOrg, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const { toast } = useToast();
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
    queryKey: ['community-categories'],
    queryFn: fetchCategories,
  });

  // Fetch posts
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['community-posts', scope, currentOrg?.id, selectedCategory, searchQuery, selectedTags],
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
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
      toast({ title: 'Post created successfully!' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create post', description: error.message, variant: 'destructive' });
    },
  });

  // Admin actions
  const toggleHideMutation = useMutation({
    mutationFn: ({ postId, hidden }: { postId: string; hidden: boolean }) =>
      togglePostHidden(postId, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
    },
  });

  const toggleLockMutation = useMutation({
    mutationFn: ({ postId, locked }: { postId: string; locked: boolean }) =>
      togglePostLocked(postId, locked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-posts'] });
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

  return (
    <AppLayout>
      <div className="container mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Community</h1>
            <p className="text-muted-foreground">
              {scope === 'org' 
                ? `Connect with your ${currentOrg?.name || 'organization'} team`
                : 'Connect with the entire platform community'
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            {scope === 'org' && (
              <Button
                variant="outline"
                onClick={() => navigate('/app/community/org/ideas/new')}
              >
                <Lightbulb className="h-4 w-4 mr-2" />
                Submit Idea
              </Button>
            )}
            <Button onClick={() => setShowPostForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Post
            </Button>
          </div>
        </div>

        {/* Scope tabs */}
        <Tabs
          value={scope}
          onValueChange={(v) => setSearchParams({ scope: v as CommunityScope })}
          className="mb-6"
        >
          <TabsList>
            {currentOrg && (
              <TabsTrigger value="org" className="gap-2">
                <Building2 className="h-4 w-4" />
                {currentOrg.name}
              </TabsTrigger>
            )}
            <TabsTrigger value="global" className="gap-2">
              <Globe className="h-4 w-4" />
              Global Community
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main content */}
          <div className="lg:col-span-3 space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search posts..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <Select
                    value={selectedCategory || 'all'}
                    onValueChange={(v) => setSelectedCategory(v === 'all' ? '' : v)}
                  >
                    <SelectTrigger className="w-full md:w-[200px]">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Active filters */}
                {(selectedCategory || selectedTags.length > 0) && (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="text-sm text-muted-foreground">Filters:</span>
                    {selectedCategory && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedCategory('')}
                        className="h-6 text-xs"
                      >
                        {categories.find((c) => c.id === selectedCategory)?.name}
                        <X className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                    {selectedTags.map((tag) => (
                      <Button
                        key={tag}
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedTags((t) => t.filter((x) => x !== tag))}
                        className="h-6 text-xs"
                      >
                        #{tag}
                        <X className="h-3 w-3 ml-1" />
                      </Button>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedCategory('');
                        setSelectedTags([]);
                      }}
                      className="h-6 text-xs"
                    >
                      Clear all
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Posts list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : posts.length === 0 ? (
              <CommunityEmptyState
                variant="posts"
                scope={scope}
                onAction={() => setShowPostForm(true)}
                actionLabel="Create First Post"
              />
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onClick={() => navigate(`/app/community/${scope}/posts/${post.id}`)}
                    isAdmin={isAdmin}
                    onToggleHide={isAdmin ? (id, hidden) => toggleHideMutation.mutate({ postId: id, hidden }) : undefined}
                    onToggleLock={isAdmin ? (id, locked) => toggleLockMutation.mutate({ postId: id, locked }) : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* AI Champions (org only) */}
            {scope === 'org' && currentOrg && (
              <AIChampionsList orgId={currentOrg.id} />
            )}

            {/* Upcoming Events */}
            {eventPosts.length > 0 && (
              <UpcomingEvents
                events={eventPosts}
                onEventClick={(event) => navigate(`/app/community/${scope}/posts/${event.id}`)}
              />
            )}

            {/* Idea Library link (org only) */}
            {scope === 'org' && currentOrg && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-warning" />
                    Idea Library
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3">
                    Browse AI and process improvement ideas submitted by your team.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => navigate('/app/community/org/ideas')}
                  >
                    View Ideas
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Categories */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id === selectedCategory ? '' : cat.id)}
                    className={`w-full text-left p-2 rounded-md transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-primary/10'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <CategoryBadge
                      name={cat.name}
                      icon={cat.icon}
                      isRestricted={cat.is_restricted}
                      size="sm"
                    />
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Popular tags */}
            {allTags.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Popular Tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {allTags.slice(0, 10).map((tag) => (
                      <Button
                        key={tag}
                        variant={selectedTags.includes(tag) ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() =>
                          setSelectedTags((t) =>
                            t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]
                          )
                        }
                      >
                        #{tag}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
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
      </div>
    </AppLayout>
  );
}
