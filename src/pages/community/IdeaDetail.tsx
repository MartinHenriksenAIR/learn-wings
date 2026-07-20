import { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { BrandingAvatar } from '@/components/ui/branding-avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IdeaStatusBadge } from '@/components/community/IdeaStatusBadge';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
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
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  ThumbsUp,
  AlertCircle,
  Send,
} from 'lucide-react';

export default function IdeaDetail() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { profile, currentOrg, effectiveIsOrgAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();
  const { flashed, flash } = useFlash();

  const [newComment, setNewComment] = useState('');
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch idea
  const { data: idea, isLoading: ideaLoading } = useQuery({
    queryKey: queryKeys.idea.detail(ideaId),
    queryFn: () => fetchIdea(ideaId!),
    enabled: !!ideaId,
  });

  // Fetch comments
  const { data: comments = [] } = useQuery({
    queryKey: queryKeys.ideaComments.list(ideaId),
    queryFn: () => fetchIdeaComments(ideaId!),
    enabled: !!ideaId,
  });

  // Seed the admin status panel once per loaded idea (the panel replaced the
  // old dialog, which seeded on open). Keyed on the id so background refetches
  // (e.g. after a comment) don't clobber in-progress admin edits.
  useEffect(() => {
    if (!idea) return;
    setNewStatus(idea.status);
    setAdminNotes(idea.admin_notes || '');
    setRejectionReason(idea.rejection_reason || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea?.id]);

  // Comment mutation
  const commentMutation = useMutation({
    mutationFn: (content: string) =>
      createIdeaComment(ideaId!, currentOrg!.id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ideaComments.list(ideaId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
      setNewComment('');
      // Routine: the new comment appearing in the thread is the feedback
      // (matches PostDetail) — no success toast (toast policy). Errors keep toasts.
    },
    onError: () => {
      toast.error('Failed to add comment');
    },
  });

  // Vote mutation — routine toggle: the button's pressed state + vote count are
  // the feedback (toast policy: like/vote toggles get no success toast). Errors keep toasts.
  const voteMutation = useMutation({
    mutationFn: () => voteForIdea(ideaId!, currentOrg!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
    },
    onError: () => {
      toast.error('Failed to vote');
    },
  });

  // Unvote mutation — routine toggle (see voteMutation): no success toast.
  const unvoteMutation = useMutation({
    mutationFn: () => removeVoteFromIdea(ideaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
    },
    onError: () => {
      toast.error('Failed to remove vote');
    },
  });

  // Status update mutation — routine save: in-button "Saved" morph, no success toast.
  const statusMutation = useMutation({
    mutationFn: () =>
      updateIdeaStatus(ideaId!, {
        status: newStatus,
        admin_notes: adminNotes || undefined,
        rejection_reason: newStatus === 'rejected' ? rejectionReason : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.ideas.all });
      flash('ideaStatus');
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

  const getBusinessAreaLabel = (value: string | null) => {
    if (!value) return null;
    return BUSINESS_AREAS.find((a) => a.value === value)?.label || value;
  };

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (ideaLoading) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: 'Idea' }]}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!idea) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }]}>
        <div className="py-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.ideaNotFound')}
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">{t('community.ideaNotFoundDescription')}</p>
          <Button
            onClick={() => navigate('/app/community/org/ideas')}
            className="rounded-[11px] text-[13px] font-bold"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            {t('community.backToIdeas')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Idea Library' }, { label: 'Idea' }]}>
      <div className="max-w-[760px]">
        {/* Back */}
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-3.5 h-auto rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground hover:bg-transparent hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {t('common.back')}
        </Button>

        {/* Idea header card */}
        <div className="mb-4 rounded-2xl border border-border bg-card px-7 py-[26px]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <IdeaStatusBadge status={idea.status} />
            {idea.business_area && (
              <span className="inline-flex items-center whitespace-nowrap rounded-[7px] bg-[#f3f4f8] px-[11px] py-1 text-[11px] font-bold text-[#686d7e]">
                {getBusinessAreaLabel(idea.business_area)}
              </span>
            )}
          </div>
          <h1 className="mb-2 font-display text-[22px] font-extrabold tracking-[-0.01em]">{idea.title}</h1>
          <p className="mb-4 text-[12.5px] font-semibold text-[#9aa0af]">
            {t('community.submittedBy', { name: idea.profile?.full_name || t('community.unknownUser') })}
            {' · '}
            {formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-[#eceef3] pt-4">
            <button
              type="button"
              onClick={handleVote}
              disabled={voteMutation.isPending || unvoteMutation.isPending}
              className={cn(
                'inline-flex items-center gap-[7px] rounded-[7px] border px-4 py-2 text-[13px] font-bold disabled:opacity-60',
                idea.user_has_voted
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-[#dcdee6] bg-card text-[#686d7e]'
              )}
            >
              <ThumbsUp
                aria-hidden="true"
                className={cn('h-3.5 w-3.5', idea.user_has_voted && 'fill-current')}
              />
              {idea.vote_count || 0}
            </button>
            <span className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-[#9aa0af]">
              <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
              {idea.comment_count || 0}
            </span>
            <div className="flex-1" />
            {idea.tags && idea.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {idea.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-[7px] bg-accent px-[11px] py-1 text-[11.5px] font-semibold text-accent-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rejection notice */}
        {idea.status === 'rejected' && idea.rejection_reason && (
          <div className="mb-4 rounded-[14px] border border-[#f3ccd0] bg-[#fdf1f1] px-5 py-4">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.05em] text-destructive">
              {t('community.ideaRejected')}
            </p>
            <p className="text-[13px] leading-[1.55] text-[#7a2e2e]">{idea.rejection_reason}</p>
          </div>
        )}

        {/* Admin notes (visible only to admins) */}
        {effectiveIsOrgAdmin && idea.admin_notes && (
          <div className="mb-4 rounded-[14px] border border-[#efddb2] bg-[#fbf2dd] px-5 py-4">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.05em] text-[#8a5e10]">
              {t('community.adminNotesInternal')}
            </p>
            <p className="text-[13px] leading-[1.55] text-[#6e4c0d]">{idea.admin_notes}</p>
          </div>
        )}

        {/* Idea content sections */}
        <div className="space-y-4">
          {/* Current Process */}
          {idea.current_process && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.currentProcessLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.current_process}</p>
              </CardContent>
            </Card>
          )}

          {/* Pain Points */}
          {idea.pain_points && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.painPointsLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.pain_points}</p>
              </CardContent>
            </Card>
          )}

          {/* Affected Roles & Frequency */}
          {(idea.affected_roles || idea.frequency_volume) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {idea.affected_roles && (
                <Card className="rounded-2xl">
                  <CardHeader className="py-4">
                    <CardTitle className="text-[14.5px] font-bold">{t('community.ideaForm.affectedRolesLabel')}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-[#4a4f60]">{idea.affected_roles}</p>
                  </CardContent>
                </Card>
              )}
              {idea.frequency_volume && (
                <Card className="rounded-2xl">
                  <CardHeader className="py-4">
                    <CardTitle className="text-[14.5px] font-bold">{t('community.ideaForm.frequencyLabel')}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-[#4a4f60]">{idea.frequency_volume}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Proposed Improvement */}
          {idea.proposed_improvement && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.proposedTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.proposed_improvement}</p>
              </CardContent>
            </Card>
          )}

          {/* Desired Process */}
          {idea.desired_process && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.desiredProcessLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.desired_process}</p>
              </CardContent>
            </Card>
          )}

          {/* Success Metrics */}
          {idea.success_metrics && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold text-success">
                  {t('community.ideaForm.successMetricsLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-[1.65] text-[#4a4f60]">{idea.success_metrics}</p>
              </CardContent>
            </Card>
          )}

          {/* Technical Details */}
          {(idea.data_inputs || idea.systems_involved || idea.constraints_risks) && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.technicalDetails')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {idea.data_inputs && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.dataInputsLabel')}</h4>
                    <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-muted-foreground">{idea.data_inputs}</p>
                  </div>
                )}
                {idea.systems_involved && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.systemsLabel')}</h4>
                    <p className="text-[13px] leading-[1.6] text-muted-foreground">{idea.systems_involved}</p>
                  </div>
                )}
                {idea.constraints_risks && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.constraintsLabel')}</h4>
                    <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-muted-foreground">{idea.constraints_risks}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Admin status panel (replaces the old dialog; in-button save feedback) */}
        {effectiveIsOrgAdmin && (
          <div className="mt-4 rounded-2xl border border-border bg-card px-6 py-5">
            <h3 className="mb-3 text-sm font-extrabold">{t('community.updateStatus')}</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#4a4f60]">{t('community.statusLabel')}</label>
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
                  <label className="text-xs font-bold text-[#4a4f60]">{t('community.rejectionReason')}</label>
                  <Textarea
                    placeholder={t('community.rejectionReasonPlaceholder')}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#4a4f60]">{t('community.adminNotesInternal')}</label>
                <Textarea
                  placeholder={t('community.adminNotesPlaceholder')}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <SaveButton
                  done={flashed('ideaStatus')}
                  idleLabel={t('common.save')}
                  onClick={() => statusMutation.mutate()}
                  disabled={statusMutation.isPending || (newStatus === 'rejected' && !rejectionReason)}
                  className="rounded-[10px] text-[13px] font-bold"
                />
              </div>
            </div>
          </div>
        )}

        {/* Comments section */}
        <div className="mt-8 space-y-4">
          <h2 className="flex items-center gap-2 text-[17px] font-bold">
            <MessageSquare aria-hidden="true" className="h-[18px] w-[18px]" />
            {t('community.discussion', { count: comments.length })}
          </h2>

          {/* Comment input */}
          <div className="rounded-2xl border border-border bg-card px-5 py-4">
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback
                  className="text-[11px] font-bold text-white"
                  style={{ backgroundColor: getAvatarColor(profile?.full_name) }}
                >
                  {getInitials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-2">
                <Textarea
                  placeholder={t('community.addCommentPlaceholder')}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[80px]"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleSubmitComment}
                    disabled={!newComment.trim() || commentMutation.isPending}
                    className="rounded-[10px] text-[13px] font-bold"
                  >
                    {commentMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send aria-hidden="true" className="h-4 w-4" />
                    )}
                    {t('community.comment')}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Comments list */}
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d6d8e0] bg-card p-8 text-center text-muted-foreground">
              <MessageSquare aria-hidden="true" className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-[13px]">{t('community.noCommentsStartDiscussion')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl border border-border bg-card px-5 py-4">
                  <div className="flex gap-3">
                    <BrandingAvatar
                      avatarPath={comment.profile?.avatar_url}
                      fallback={getInitials(comment.profile?.full_name)}
                      className="h-8 w-8 shrink-0"
                      fallbackClassName="text-[11px] font-bold text-white"
                      fallbackStyle={{ backgroundColor: getAvatarColor(comment.profile?.full_name) }}
                    />
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[13px] font-bold">
                          {comment.profile?.full_name || t('community.unknownUser')}
                        </span>
                        <span className="text-[11.5px] text-[#9aa0af]">
                          {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#4a4f60]">
                        {comment.content}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
