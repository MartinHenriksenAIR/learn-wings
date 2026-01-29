import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Library, Search, ThumbsUp, MessageSquare, User } from 'lucide-react';
import { Idea, IDEA_STATUS_CONFIG, IdeaStatus } from '@/lib/ideas-types';
import { IdeaDetailDialog } from './IdeaDetailDialog';
import { formatDistanceToNow } from 'date-fns';

export function IdeaLibrary() {
  const { currentOrg, profile } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | 'all'>('all');
  const [viewingIdea, setViewingIdea] = useState<Idea | null>(null);

  const { data: ideas, isLoading } = useQuery({
    queryKey: ['idea-library', currentOrg?.id],
    queryFn: async () => {
      if (!currentOrg?.id) return [];
      
      const { data, error } = await supabase
        .from('ideas')
        .select(`
          *,
          profile:profiles!ideas_user_id_fkey(id, full_name, first_name, last_name, department),
          category:idea_categories(id, name)
        `)
        .eq('org_id', currentOrg.id)
        .neq('status', 'draft')
        .order('submitted_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as Idea[];
    },
    enabled: !!currentOrg?.id,
  });

  // Fetch vote counts for ideas
  const { data: voteCounts } = useQuery({
    queryKey: ['idea-votes', currentOrg?.id],
    queryFn: async () => {
      if (!currentOrg?.id) return {};
      
      const { data, error } = await supabase
        .from('idea_votes')
        .select('idea_id')
        .eq('org_id', currentOrg.id);

      if (error) throw error;
      
      const counts: Record<string, number> = {};
      data.forEach((vote) => {
        counts[vote.idea_id] = (counts[vote.idea_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!currentOrg?.id,
  });

  // Fetch user's votes
  const { data: userVotes } = useQuery({
    queryKey: ['user-votes', profile?.id, currentOrg?.id],
    queryFn: async () => {
      if (!profile?.id || !currentOrg?.id) return new Set<string>();
      
      const { data, error } = await supabase
        .from('idea_votes')
        .select('idea_id')
        .eq('user_id', profile.id)
        .eq('org_id', currentOrg.id);

      if (error) throw error;
      return new Set(data.map((v) => v.idea_id));
    },
    enabled: !!profile?.id && !!currentOrg?.id,
  });

  // Fetch comment counts
  const { data: commentCounts } = useQuery({
    queryKey: ['idea-comments-count', currentOrg?.id],
    queryFn: async () => {
      if (!currentOrg?.id) return {};
      
      const { data, error } = await supabase
        .from('idea_comments')
        .select('idea_id')
        .eq('org_id', currentOrg.id);

      if (error) throw error;
      
      const counts: Record<string, number> = {};
      data.forEach((comment) => {
        counts[comment.idea_id] = (counts[comment.idea_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!currentOrg?.id,
  });

  const filteredIdeas = ideas?.filter((idea) => {
    const matchesSearch = !searchQuery || 
      idea.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.problem_statement?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || idea.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-4">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ideas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IdeaStatus | 'all')}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filteredIdeas?.length ? (
        <EmptyState
          icon={<Library className="h-6 w-6" />}
          title={searchQuery || statusFilter !== 'all' ? 'No matching ideas' : 'No ideas submitted yet'}
          description={
            searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your search or filter criteria.'
              : 'Be the first to submit an idea! Start by brainstorming with AI.'
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {filteredIdeas.length} idea{filteredIdeas.length !== 1 ? 's' : ''}
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredIdeas.map((idea) => {
              const statusConfig = IDEA_STATUS_CONFIG[idea.status];
              const voteCount = voteCounts?.[idea.id] || 0;
              const commentCount = commentCounts?.[idea.id] || 0;
              const hasVoted = userVotes?.has(idea.id);

              return (
                <Card 
                  key={idea.id} 
                  className="flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => setViewingIdea(idea)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base line-clamp-2">{idea.title}</CardTitle>
                      <Badge className={statusConfig.color} variant="secondary">
                        {statusConfig.label}
                      </Badge>
                    </div>
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <User className="h-3 w-3" />
                      {idea.profile?.full_name || 'Unknown'}
                      {idea.profile?.department && (
                        <span className="text-muted-foreground">• {idea.profile.department}</span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 pb-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {idea.description || idea.problem_statement || 'No description provided'}
                    </p>
                    {idea.category && (
                      <Badge variant="outline" className="mt-2">
                        {idea.category.name}
                      </Badge>
                    )}
                  </CardContent>
                  <div className="px-6 pb-4 pt-0 flex items-center gap-4 text-sm text-muted-foreground">
                    <span className={`flex items-center gap-1 ${hasVoted ? 'text-primary' : ''}`}>
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {voteCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {commentCount}
                    </span>
                    <span className="ml-auto text-xs">
                      {idea.submitted_at && formatDistanceToNow(new Date(idea.submitted_at), { addSuffix: true })}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <IdeaDetailDialog
        idea={viewingIdea}
        open={!!viewingIdea}
        onOpenChange={(open) => !open && setViewingIdea(null)}
      />
    </>
  );
}
