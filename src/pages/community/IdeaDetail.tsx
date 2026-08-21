import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import { routes } from '@/lib/routes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { useCommunityGate } from '@/hooks/useCommunityGate';
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
import { cn } from '@/lib/utils';
import { formatDistanceToNowLocalized } from '@/lib/date-locale';
import { toast } from 'sonner';
import {
  Loader2,
  MessageSquare,
  ThumbsUp,
  AlertCircle,
  Send,
} from 'lucide-react';

export default function IdeaDetail() {
  const { ideaId } = useParams<{ ideaId: string }>();
  const { t, i18n } = useTranslation();
  const { profile, effectiveIsOrgAdmin } = useAuth();
  const communityGate = useCommunityGate();
  const queryClient = useQueryClient();
  const { flashed, flash } = useFlash();

  const [newComment, setNewComment] = useState('');
  const [newStatus, setNewStatus] = useState<IdeaStatusExtended>('submitted');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const { data: idea, isLoading: ideaLoading } = useQuery({
    queryKey: queryKeys.idea.detail(ideaId),
    queryFn: () => fetchIdea(ideaId!),
    enabled: !!ideaId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: queryKeys.ideaComments.list(ideaId),
    queryFn: () => fetchIdeaComments(ideaId!),
    enabled: !!ideaId,
  });

  useEffect(() => {
    if (!idea) return;
    setNewStatus(idea.status);
    setAdminNotes(idea.admin_notes || '');
    setRejectionReason(idea.rejection_reason || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea?.id]);

  const commentMutation = useMutation({
    mutationFn: (content: string) => createIdeaComment(ideaId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ideaComments.list(ideaId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
      setNewComment('');
    },
    onError: () => {
      toast.error(t('community.toasts.commentAddFailed'));
    },
  });

  const voteMutation = useMutation({
    mutationFn: () => voteForIdea(ideaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
    },
    onError: () => {
      toast.error(t('community.toasts.voteFailed'));
    },
  });

  const unvoteMutation = useMutation({
    mutationFn: () => removeVoteFromIdea(ideaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idea.detail(ideaId) });
    },
    onError: () => {
      toast.error(t('community.toasts.unvoteFailed'));
    },
  });

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
      toast.error(t('community.toasts.statusUpdateFailed'));
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

  if (communityGate === 'redirect') return <Navigate to={routes.learner.dashboard} replace />;

  if (ideaLoading) {
    return (
      <AppLayout headerLabel={t('community.idea')}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-legacy-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!idea) {
    return (
      <AppLayout headerLabel={t('community.ideaLibrary')}>
        <div className="py-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-legacy-muted-foreground" />
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {t('community.ideaNotFound')}
          </h1>
          <p className="text-sm text-legacy-muted-foreground">{t('community.ideaNotFoundDescription')}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerLabel={t('community.idea')}>
      <div className="max-w-[760px]">
        <div className="mb-4 rounded-legacy-2xl border border-legacy-border bg-legacy-card px-7 py-[26px]">
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
            {formatDistanceToNowLocalized(new Date(idea.created_at), i18n.language)}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-[#eceef3] pt-4">
            <button
              type="button"
              onClick={handleVote}
              disabled={voteMutation.isPending || unvoteMutation.isPending}
              className={cn(
                'inline-flex items-center gap-[7px] rounded-[7px] border px-4 py-2 text-[13px] font-bold disabled:opacity-60',
                idea.user_has_voted
                  ? 'border-legacy-primary bg-legacy-accent text-legacy-accent-foreground'
                  : 'border-[#dcdee6] bg-legacy-card text-[#686d7e]'
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
                    className="rounded-[7px] bg-legacy-accent px-[11px] py-1 text-[11.5px] font-semibold text-legacy-accent-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {idea.status === 'rejected' && idea.rejection_reason && (
          <div className="mb-4 rounded-[14px] border border-[#f3ccd0] bg-[#fdf1f1] px-5 py-4">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.05em] text-legacy-destructive">
              {t('community.ideaRejected')}
            </p>
            <p className="text-[13px] leading-[1.55] text-[#7a2e2e]">{idea.rejection_reason}</p>
          </div>
        )}

        {effectiveIsOrgAdmin && idea.admin_notes && (
          <div className="mb-4 rounded-[14px] border border-[#efddb2] bg-[#fbf2dd] px-5 py-4">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.05em] text-[#8a5e10]">
              {t('community.adminNotesInternal')}
            </p>
            <p className="text-[13px] leading-[1.55] text-[#6e4c0d]">{idea.admin_notes}</p>
          </div>
        )}

        <div className="space-y-4">
          {idea.current_process && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.currentProcessLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.current_process}</p>
              </CardContent>
            </Card>
          )}

          {idea.pain_points && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.painPointsLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.pain_points}</p>
              </CardContent>
            </Card>
          )}

          {(idea.affected_roles || idea.frequency_volume) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {idea.affected_roles && (
                <Card className="rounded-legacy-2xl">
                  <CardHeader className="py-4">
                    <CardTitle className="text-[14.5px] font-bold">{t('community.ideaForm.affectedRolesLabel')}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-[#4a4f60]">{idea.affected_roles}</p>
                  </CardContent>
                </Card>
              )}
              {idea.frequency_volume && (
                <Card className="rounded-legacy-2xl">
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

          {idea.proposed_improvement && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.proposedTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.proposed_improvement}</p>
              </CardContent>
            </Card>
          )}

          {idea.desired_process && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.ideaForm.desiredProcessLabel')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{idea.desired_process}</p>
              </CardContent>
            </Card>
          )}

          {idea.success_metrics && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold text-legacy-success">
                  {t('community.ideaForm.successMetricsLabel')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-[1.65] text-[#4a4f60]">{idea.success_metrics}</p>
              </CardContent>
            </Card>
          )}

          {(idea.data_inputs || idea.systems_involved || idea.constraints_risks) && (
            <Card className="rounded-legacy-2xl">
              <CardHeader>
                <CardTitle className="text-[17px] font-bold">{t('community.technicalDetails')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {idea.data_inputs && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.dataInputsLabel')}</h4>
                    <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-legacy-muted-foreground">{idea.data_inputs}</p>
                  </div>
                )}
                {idea.systems_involved && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.systemsLabel')}</h4>
                    <p className="text-[13px] leading-[1.6] text-legacy-muted-foreground">{idea.systems_involved}</p>
                  </div>
                )}
                {idea.constraints_risks && (
                  <div>
                    <h4 className="mb-1 text-[13px] font-bold">{t('community.ideaForm.constraintsLabel')}</h4>
                    <p className="whitespace-pre-wrap text-[13px] leading-[1.6] text-legacy-muted-foreground">{idea.constraints_risks}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {effectiveIsOrgAdmin && (
          <div className="mt-4 rounded-legacy-2xl border border-legacy-border bg-legacy-card px-6 py-5">
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
                        {t(s.labelKey)}
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

        <div className="mt-8 space-y-4">
          <h2 className="flex items-center gap-2 text-[17px] font-bold">
            <MessageSquare aria-hidden="true" className="h-[18px] w-[18px]" />
            {t('community.discussion', { count: comments.length })}
          </h2>

          <div className="rounded-legacy-2xl border border-legacy-border bg-legacy-card px-5 py-4">
            <div className="flex gap-3">
              <BrandingAvatar
                avatarPath={profile?.avatar_url}
                name={profile?.full_name}
                className="h-8 w-8 shrink-0"
                fallbackClassName="text-[11px] font-bold text-white"
              />
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

          {comments.length === 0 ? (
            <div className="rounded-legacy-2xl border border-dashed border-[#d6d8e0] bg-legacy-card p-8 text-center text-legacy-muted-foreground">
              <MessageSquare aria-hidden="true" className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-[13px]">{t('community.noCommentsStartDiscussion')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-legacy-2xl border border-legacy-border bg-legacy-card px-5 py-4">
                  <div className="flex gap-3">
                    <BrandingAvatar
                      avatarPath={comment.profile?.avatar_url}
                      name={comment.profile?.full_name}
                      className="h-8 w-8 shrink-0"
                      fallbackClassName="text-[11px] font-bold text-white"
                    />
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[13px] font-bold">
                          {comment.profile?.full_name || t('community.unknownUser')}
                        </span>
                        <span className="text-[11.5px] text-[#9aa0af]">
                          {formatDistanceToNowLocalized(new Date(comment.created_at), i18n.language)}
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
