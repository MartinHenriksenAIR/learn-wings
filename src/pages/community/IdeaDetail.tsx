import { useState } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IdeaStatusBadge } from '@/components/community/IdeaStatusBadge';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import {
  fetchIdea,
  fetchIdeaComments,
  createIdeaComment,
  voteForIdea,
  removeVoteFromIdea,
  updateIdeaStatus,
} from '@/lib/ideas-api';
import { BUSINESS_AREAS, IDEA_STATUS_OPTIONS } from '@/lib/community-types';
import type { IdeaStatusExtended } from '@/lib/community-types';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  ThumbsUp,
  User,
  Calendar,
  Briefcase,
  Tag,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Send,
} from 'lucide-react';

export default function IdeaDetail() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const navigate = useNavigate();
  const { profile, currentOrg, effectiveIsOrgAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();

  const [newComment, setNewComment] = useState('');
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch idea
  const { data: idea, isLoading: ideaLoading } = useQuery({
    queryKey: ['idea', ideaId],
    queryFn: () => fetchIdea(ideaId!),
    enabled: !!ideaId,
  });

  // Fetch comments
  const { data: comments = [] } = useQuery({
    queryKey: ['idea-comments', ideaId],
    queryFn: () => fetchIdeaComments(ideaId!),
    enabled: !!ideaId,
  });

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: (content: string) => 
      createIdeaComment(ideaId!, currentOrg!.id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea-comments', ideaId] });
      queryClient.invalidateQueries({ queryKey: ['idea', ideaId] });
      setNewComment('');
      toast.success('Comment added');
    },
    onError: () => {
      toast.error('Failed to add comment');
    },
  });

  // Vote mutation
  const voteMutation = useMutation({
    mutationFn: () => voteForIdea(ideaId!, currentOrg!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea', ideaId] });
      toast.success('Vote recorded');
    },
    onError: () => {
      toast.error('Failed to vote');
    },
  });

  // Unvote mutation
  const unvoteMutation = useMutation({
    mutationFn: () => removeVoteFromIdea(ideaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea', ideaId] });
      toast.success('Vote removed');
    },
    onError: () => {
      toast.error('Failed to remove vote');
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: () => 
      updateIdeaStatus(ideaId!, {
        status: newStatus,
        admin_notes: adminNotes || undefined,
        rejection_reason: newStatus === 'rejected' ? rejectionReason : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['idea', ideaId] });
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      setStatusDialogOpen(false);
      toast.success('Status updated');
    },
    onError: () => {
      toast.error('Failed to update status');
    },
  });

  const handleVote = () => {
    if (idea?.user_has_voted) {
      unvoteMutation.mutate();
    } else {
      voteMutation.mutate();
    }
  };

  const handleSubmitComment = () => {
    if (!newComment.trim()) return;
    commentMutation.mutate(newComment.trim());
  };

  const openStatusDialog = () => {
    if (idea) {
      setNewStatus(idea.status);
      setAdminNotes(idea.admin_notes || '');
      setRejectionReason(idea.rejection_reason || '');
    }
    setStatusDialogOpen(true);
  };

  const getBusinessAreaLabel = (value: string | null) => {
    if (!value) return null;
    return BUSINESS_AREAS.find((a) => a.value === value)?.label || value;
  };

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (ideaLoading) {
    return (
      <AppLayout title="Idea" breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: 'Idea' }]}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!idea) {
    return (
      <AppLayout title="Idea Not Found" breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }]}>
        <div className="container mx-auto py-12 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Idea Not Found</h1>
          <p className="text-muted-foreground mb-4">
            The idea you're looking for doesn't exist or you don't have access.
          </p>
          <Button onClick={() => navigate('/app/community/org/ideas')}>
            Back to Ideas
          </Button>
        </div>
      </AppLayout>
    );
  }

  const isAuthor = idea.user_id === profile?.id;

  return (
    <AppLayout title={idea.title} breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: 'Idea' }]}>
      <div className="container max-w-4xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/community/org/ideas')}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>

        {/* Idea header card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <IdeaStatusBadge status={idea.status} />
                <CardTitle className="text-2xl">{idea.title}</CardTitle>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    {idea.profile?.full_name || 'Unknown'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })}
                  </span>
                  {idea.business_area && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="h-4 w-4" />
                      {getBusinessAreaLabel(idea.business_area)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={idea.user_has_voted ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleVote}
                  disabled={voteMutation.isPending || unvoteMutation.isPending}
                >
                  <ThumbsUp className={`h-4 w-4 mr-1 ${idea.user_has_voted ? 'fill-current' : ''}`} />
                  {idea.vote_count || 0}
                </Button>
                <Button variant="outline" size="sm" disabled>
                  <MessageSquare className="h-4 w-4 mr-1" />
                  {idea.comment_count || 0}
                </Button>
                {effectiveIsOrgAdmin && (
                  <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" onClick={openStatusDialog}>
                        Update Status
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Update Idea Status</DialogTitle>
                        <DialogDescription>
                          Change the status and add notes for this idea.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Status</label>
                          <Select
                            value={newStatus}
                            onValueChange={(v) => setNewStatus(v as IdeaStatusExtended)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {IDEA_STATUS_OPTIONS.filter(s => s.value !== 'draft').map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {newStatus === 'rejected' && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Rejection Reason *</label>
                            <Textarea
                              placeholder="Explain why this idea was rejected..."
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Admin Notes (internal)</label>
                          <Textarea
                            placeholder="Notes visible only to admins..."
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setStatusDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => statusMutation.mutate()}
                          disabled={statusMutation.isPending || (newStatus === 'rejected' && !rejectionReason)}
                        >
                          {statusMutation.isPending && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          Save Changes
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
            {/* Tags */}
            {idea.tags && idea.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {idea.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>
        </Card>

        {/* Rejection notice */}
        {idea.status === 'rejected' && idea.rejection_reason && (
          <Card className="mb-6 border-destructive/50 bg-destructive/5">
            <CardHeader className="py-4">
              <div className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-destructive mt-0.5" />
                <div>
                  <CardTitle className="text-base text-destructive">Idea Rejected</CardTitle>
                  <CardDescription className="text-destructive/80 mt-1">
                    {idea.rejection_reason}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Admin notes (visible only to admins) */}
        {effectiveIsOrgAdmin && idea.admin_notes && (
          <Card className="mb-6 border-primary/50 bg-primary/5">
            <CardHeader className="py-4">
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <CardTitle className="text-base text-primary">Admin Notes (Internal)</CardTitle>
                  <CardDescription className="text-primary/80 mt-1">
                    {idea.admin_notes}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Idea content sections */}
        <div className="space-y-6">
          {/* Current Process */}
          {idea.current_process && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Current Process (As-Is)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.current_process}</p>
              </CardContent>
            </Card>
          )}

          {/* Pain Points */}
          {idea.pain_points && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pain Points / Why It Matters</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.pain_points}</p>
              </CardContent>
            </Card>
          )}

          {/* Affected Roles & Frequency */}
          {(idea.affected_roles || idea.frequency_volume) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {idea.affected_roles && (
                <Card>
                  <CardHeader className="py-4">
                    <CardTitle className="text-base">Who Is Affected</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-muted-foreground">{idea.affected_roles}</p>
                  </CardContent>
                </Card>
              )}
              {idea.frequency_volume && (
                <Card>
                  <CardHeader className="py-4">
                    <CardTitle className="text-base">Frequency / Volume</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-muted-foreground">{idea.frequency_volume}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Proposed Improvement */}
          {idea.proposed_improvement && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Proposed Improvement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.proposed_improvement}</p>
              </CardContent>
            </Card>
          )}

          {/* Desired Process */}
          {idea.desired_process && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Desired Future State (To-Be)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{idea.desired_process}</p>
              </CardContent>
            </Card>
          )}

          {/* Success Metrics */}
          {idea.success_metrics && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Success Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{idea.success_metrics}</p>
              </CardContent>
            </Card>
          )}

          {/* Technical Details */}
          {(idea.data_inputs || idea.systems_involved || idea.constraints_risks) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Technical Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {idea.data_inputs && (
                  <div>
                    <h4 className="font-medium mb-1">Data Inputs</h4>
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">{idea.data_inputs}</p>
                  </div>
                )}
                {idea.systems_involved && (
                  <div>
                    <h4 className="font-medium mb-1">Systems / Tools Involved</h4>
                    <p className="text-muted-foreground text-sm">{idea.systems_involved}</p>
                  </div>
                )}
                {idea.constraints_risks && (
                  <div>
                    <h4 className="font-medium mb-1">Constraints / Risks</h4>
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">{idea.constraints_risks}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Comments section */}
        <Separator className="my-8" />
        
        <div className="space-y-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Discussion ({comments.length})
          </h2>

          {/* Comment input */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {profile?.full_name?.slice(0, 2).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <Textarea
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="min-h-[80px]"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleSubmitComment}
                      disabled={!newComment.trim() || commentMutation.isPending}
                    >
                      {commentMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Comment
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Comments list */}
          {comments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No comments yet. Start the discussion!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <Card key={comment.id}>
                  <CardContent className="pt-4">
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {comment.profile?.full_name?.slice(0, 2).toUpperCase() || 'U'}
                        </AvatarFallback>
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
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
