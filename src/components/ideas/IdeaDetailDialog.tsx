import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThumbsUp, MessageSquare, Send, User, Calendar, Tag } from 'lucide-react';
import { Idea, IDEA_STATUS_CONFIG, IdeaComment } from '@/lib/ideas-types';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';

interface IdeaDetailDialogProps {
  idea: Idea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IdeaDetailDialog({ idea, open, onOpenChange }: IdeaDetailDialogProps) {
  const { profile, currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');

  // Fetch comments for this idea
  const { data: comments } = useQuery({
    queryKey: ['idea-comments', idea?.id],
    queryFn: async () => {
      if (!idea?.id) return [];
      
      const { data, error } = await supabase
        .from('idea_comments')
        .select(`
          *,
          profile:profiles!idea_comments_user_id_fkey(id, full_name, first_name, last_name)
        `)
        .eq('idea_id', idea.id)
        .is('parent_comment_id', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as IdeaComment[];
    },
    enabled: !!idea?.id,
  });

  // Check if user has voted
  const { data: hasVoted } = useQuery({
    queryKey: ['user-vote', idea?.id, profile?.id],
    queryFn: async () => {
      if (!idea?.id || !profile?.id) return false;
      
      const { data, error } = await supabase
        .from('idea_votes')
        .select('id')
        .eq('idea_id', idea.id)
        .eq('user_id', profile.id)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!idea?.id && !!profile?.id,
  });

  // Get vote count
  const { data: voteCount } = useQuery({
    queryKey: ['vote-count', idea?.id],
    queryFn: async () => {
      if (!idea?.id) return 0;
      
      const { count, error } = await supabase
        .from('idea_votes')
        .select('*', { count: 'exact', head: true })
        .eq('idea_id', idea.id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!idea?.id,
  });

  const voteMutation = useMutation({
    mutationFn: async () => {
      if (!idea?.id || !profile?.id || !currentOrg?.id) throw new Error('Not authenticated');

      if (hasVoted) {
        const { error } = await supabase
          .from('idea_votes')
          .delete()
          .eq('idea_id', idea.id)
          .eq('user_id', profile.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('idea_votes')
          .insert({
            idea_id: idea.id,
            user_id: profile.id,
            org_id: currentOrg.id,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-vote', idea?.id] });
      queryClient.invalidateQueries({ queryKey: ['vote-count', idea?.id] });
      queryClient.invalidateQueries({ queryKey: ['idea-votes'] });
      queryClient.invalidateQueries({ queryKey: ['user-votes'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!idea?.id || !profile?.id || !currentOrg?.id) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('idea_comments')
        .insert({
          idea_id: idea.id,
          user_id: profile.id,
          org_id: currentOrg.id,
          content,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea-comments', idea?.id] });
      queryClient.invalidateQueries({ queryKey: ['idea-comments-count'] });
      setNewComment('');
      toast({ title: 'Comment added' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    commentMutation.mutate(newComment.trim());
  };

  if (!idea) return null;

  const statusConfig = IDEA_STATUS_CONFIG[idea.status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <DialogTitle className="text-xl">{idea.title}</DialogTitle>
            <Badge className={statusConfig.color} variant="secondary">
              {statusConfig.label}
            </Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Meta information */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {idea.profile && (
                <span className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  {idea.profile.full_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {idea.submitted_at 
                  ? format(new Date(idea.submitted_at), 'MMM d, yyyy')
                  : format(new Date(idea.created_at), 'MMM d, yyyy')}
              </span>
              {idea.category && (
                <span className="flex items-center gap-1">
                  <Tag className="h-4 w-4" />
                  {idea.category.name}
                </span>
              )}
            </div>

            {/* Vote and comment buttons */}
            <div className="flex items-center gap-4">
              <Button
                variant={hasVoted ? 'default' : 'outline'}
                size="sm"
                onClick={() => voteMutation.mutate()}
                disabled={voteMutation.isPending || idea.user_id === profile?.id}
              >
                <ThumbsUp className="h-4 w-4 mr-2" />
                {hasVoted ? 'Upvoted' : 'Upvote'} ({voteCount})
              </Button>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <MessageSquare className="h-4 w-4" />
                {comments?.length || 0} comments
              </span>
            </div>

            <Separator />

            {/* Idea content sections */}
            {idea.description && (
              <div>
                <h3 className="font-semibold mb-2">Description</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.description}</p>
              </div>
            )}

            {idea.problem_statement && (
              <div>
                <h3 className="font-semibold mb-2">Problem Statement</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.problem_statement}</p>
              </div>
            )}

            {idea.proposed_solution && (
              <div>
                <h3 className="font-semibold mb-2">Proposed Solution</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.proposed_solution}</p>
              </div>
            )}

            {idea.expected_impact && (
              <div>
                <h3 className="font-semibold mb-2">Expected Impact</h3>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.expected_impact}</p>
              </div>
            )}

            <Separator />

            {/* Comments section */}
            <div>
              <h3 className="font-semibold mb-4">Discussion</h3>
              
              <div className="space-y-4 mb-4">
                {comments?.map((comment) => {
                  const initials = comment.profile?.full_name
                    ?.split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || '?';

                  return (
                    <div key={comment.id} className="flex gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">
                            {comment.profile?.full_name || 'Unknown'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {comment.content}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {comments?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No comments yet. Be the first to share your thoughts!
                  </p>
                )}
              </div>

              {/* Add comment */}
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[60px]"
                />
                <Button
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || commentMutation.isPending}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
