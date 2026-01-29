import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, Lightbulb, Edit, Trash2, Send, Eye } from 'lucide-react';
import { Idea, IDEA_STATUS_CONFIG, IdeaStatus } from '@/lib/ideas-types';
import { IdeaFormDialog } from './IdeaFormDialog';
import { IdeaDetailDialog } from './IdeaDetailDialog';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
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

export function MyIdeas() {
  const { profile, currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [viewingIdea, setViewingIdea] = useState<Idea | null>(null);
  const [deletingIdea, setDeletingIdea] = useState<Idea | null>(null);

  const { data: ideas, isLoading } = useQuery({
    queryKey: ['my-ideas', profile?.id, currentOrg?.id],
    queryFn: async () => {
      if (!profile?.id || !currentOrg?.id) return [];
      
      const { data, error } = await supabase
        .from('ideas')
        .select(`
          *,
          category:idea_categories(id, name)
        `)
        .eq('user_id', profile.id)
        .eq('org_id', currentOrg.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as Idea[];
    },
    enabled: !!profile?.id && !!currentOrg?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ideaId: string) => {
      const { error } = await supabase
        .from('ideas')
        .delete()
        .eq('id', ideaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-ideas'] });
      toast({ title: 'Idea deleted' });
      setDeletingIdea(null);
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (ideaId: string) => {
      const { error } = await supabase
        .from('ideas')
        .update({ status: 'submitted' as IdeaStatus, submitted_at: new Date().toISOString() })
        .eq('id', ideaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-ideas'] });
      toast({ title: 'Idea submitted for review' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleEdit = (idea: Idea) => {
    setEditingIdea(idea);
    setFormDialogOpen(true);
  };

  const handleView = (idea: Idea) => {
    setViewingIdea(idea);
  };

  const handleCloseForm = () => {
    setFormDialogOpen(false);
    setEditingIdea(null);
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
    );
  }

  if (!ideas?.length) {
    return (
      <>
        <EmptyState
          icon={<Lightbulb className="h-6 w-6" />}
          title="No ideas yet"
          description="Start brainstorming with AI or create your first idea to begin contributing process optimization suggestions."
          action={
            <Button onClick={() => setFormDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Idea
            </Button>
          }
        />

        <IdeaFormDialog
          open={formDialogOpen}
          onOpenChange={setFormDialogOpen}
          idea={null}
          onClose={handleCloseForm}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {ideas.length} idea{ideas.length !== 1 ? 's' : ''}
        </p>
        <Button onClick={() => setFormDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Idea
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {ideas.map((idea) => {
          const statusConfig = IDEA_STATUS_CONFIG[idea.status];
          const isDraft = idea.status === 'draft';

          return (
            <Card key={idea.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base line-clamp-2">{idea.title}</CardTitle>
                  <Badge className={statusConfig.color} variant="secondary">
                    {statusConfig.label}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Updated {formatDistanceToNow(new Date(idea.updated_at), { addSuffix: true })}
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
              <div className="px-6 pb-4 pt-0 flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => handleView(idea)}>
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </Button>
                {isDraft && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => handleEdit(idea)}>
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => submitMutation.mutate(idea.id)}
                      disabled={!idea.title || submitMutation.isPending}
                    >
                      <Send className="h-3 w-3 mr-1" />
                      Submit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeletingIdea(idea)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <IdeaFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        idea={editingIdea}
        onClose={handleCloseForm}
      />

      <IdeaDetailDialog
        idea={viewingIdea}
        open={!!viewingIdea}
        onOpenChange={(open) => !open && setViewingIdea(null)}
      />

      <AlertDialog open={!!deletingIdea} onOpenChange={(open) => !open && setDeletingIdea(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Idea</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingIdea?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingIdea && deleteMutation.mutate(deletingIdea.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
