import { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { AppLayout } from '@/components/layout/AppLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/community/CategoryBadge';
import { TagList } from '@/components/community/TagList';
import { CommentThread } from '@/components/community/CommentThread';
import { ReportDialog } from '@/components/community/ReportDialog';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api-client';
import {
  fetchPost,
  fetchComments,
  createComment,
  updateComment,
  deleteComment,
  createReport,
  deletePost,
  togglePostHidden,
  togglePostLocked,
  toggleCommentHidden,
} from '@/lib/community-api';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  ExternalLink,
  Edit2,
  Trash2,
  Flag,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Loader2,
  Pin,
} from 'lucide-react';
import { format } from 'date-fns';
import { getAvatarColor, getInitials } from '@/lib/utils';
import type { CommunityScope } from '@/lib/community-types';

export default function PostDetail() {
  const { postId, scope: routeScope } = useParams<{ postId: string; scope: CommunityScope }>();
  const navigate = useNavigate();
  const scope = (routeScope || 'org') as CommunityScope;
  const { profile, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<string>('');
  const [reportTargetType, setReportTargetType] = useState<'post' | 'comment'>('post');
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);

  // Fetch post
  const { data: post, isLoading: postLoading } = useQuery({
    queryKey: queryKeys.communityPost.detail(postId),
    queryFn: () => fetchPost(postId!),
    enabled: !!postId,
  });

  // Fetch comments
  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: queryKeys.communityComments.list(postId),
    queryFn: () => fetchComments(postId!),
    enabled: !!postId,
  });

  const isAuthor = profile?.id === post?.user_id;
  const isAdmin = post?.scope === 'global' 
    ? effectiveIsPlatformAdmin 
    : effectiveIsOrgAdmin || effectiveIsPlatformAdmin;
  const isRestricted = post?.category?.is_restricted;

  // Mutations
  const createCommentMutation = useMutation({
    mutationFn: ({ content, parentId }: { content: string; parentId?: string }) =>
      createComment({ post_id: postId!, content, parent_comment_id: parentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityComments.list(postId) });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to add comment', description: error.message, variant: 'destructive' });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      updateComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityComments.list(postId) });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityComments.list(postId) });
      toast({ title: 'Comment deleted' });
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: () => deletePost(postId!),
    onSuccess: () => {
      toast({ title: 'Post deleted' });
      navigate(`/app/community?scope=${scope}`);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete post', description: error.message, variant: 'destructive' });
    },
  });

  const toggleHideMutation = useMutation({
    mutationFn: (hidden: boolean) => togglePostHidden(postId!, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityPost.detail(postId) });
    },
  });

  const toggleLockMutation = useMutation({
    mutationFn: (locked: boolean) => togglePostLocked(postId!, locked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityPost.detail(postId) });
    },
  });

  const toggleCommentHideMutation = useMutation({
    mutationFn: ({ commentId, hidden }: { commentId: string; hidden: boolean }) =>
      toggleCommentHidden(commentId, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.communityComments.list(postId) });
    },
  });

  const reportMutation = useMutation({
    mutationFn: (reason: string) =>
      createReport({
        target_type: reportTargetType,
        target_id: reportTargetId,
        org_id: post?.scope === 'org' ? post.org_id || undefined : undefined,
        reason,
      }),
    onSuccess: () => {
      toast({ title: 'Report submitted', description: 'Thank you for helping keep our community safe.' });
      setShowReportDialog(false);
    },
    onError: (error: Error) => {
      // 409 (already reported) is handled at the dialog boundary (#21) — it gets
      // its own informational toast there, not a misleading failure toast here.
      if (error instanceof ApiError && error.status === 409) return;
      toast({ title: 'Failed to submit report', description: error.message, variant: 'destructive' });
    },
  });

  const handleReportPost = () => {
    setReportTargetId(postId!);
    setReportTargetType('post');
    setShowReportDialog(true);
  };

  const handleReportComment = (commentId: string) => {
    setReportTargetId(commentId);
    setReportTargetType('comment');
    setShowReportDialog(true);
  };

  useEffect(() => {
    if (!comments.length || !window.location.hash.startsWith('#comment-')) return;

    const commentId = window.location.hash.replace('#comment-', '');
    const el = document.getElementById(`comment-${commentId}`);
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedCommentId(commentId);
    const timer = window.setTimeout(() => setHighlightedCommentId(null), 2500);

    return () => window.clearTimeout(timer);
  }, [comments]);

  // The community gate is keyed on the VIEWER's effective flags (platform + their
  // currentOrg override), not the reported post's org. Platform admins moderating an
  // org-scoped report must not be bounced just because their own org has community
  // disabled (or they have no org selected). Backend authz already permits them.
  if (!settingsLoading && !features.community_enabled && !effectiveIsPlatformAdmin) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (postLoading) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Post' }]}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!post) {
    return (
      <AppLayout breadcrumbs={[{ label: 'Community' }]}>
        <div className="py-12 text-center">
          <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-[-0.02em]">{t('community.postNotFound')}</h1>
          <p className="mb-4 text-sm text-muted-foreground">{t('community.postNotFoundDescription')}</p>
          <Button
            onClick={() => navigate(`/app/community?scope=${scope}`)}
            className="rounded-[11px] text-[13px] font-bold"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('community.backToCommunity')}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const authorName = post.profile?.full_name;
  const initials = getInitials(authorName);

  const isEvent = post.category?.slug === 'events';

  return (
    <AppLayout breadcrumbs={[{ label: 'Community' }, { label: 'Post' }]}>
      <div className="max-w-[760px]">
        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => navigate(`/app/community?scope=${scope}`)}
          className="mb-3.5 h-auto rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground hover:bg-transparent hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {t('community.backToCommunity')}
        </Button>

        {/* Post card */}
        <div className="mb-4 rounded-2xl border border-border bg-card px-[26px] py-6">
          <div className="mb-3.5 flex items-center gap-2.5">
            <Avatar className="h-[38px] w-[38px] shrink-0">
              <AvatarFallback
                className="text-xs font-bold text-white"
                style={{ backgroundColor: getAvatarColor(authorName) }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-bold">{authorName || t('community.unknownUser')}</span>
              <span className="text-[11.5px] text-[#9aa0af]">
                {format(new Date(post.created_at), 'MMM d, yyyy · h:mm a')}
              </span>
            </div>
            <div className="flex-1" />
            <div className="flex shrink-0 items-center gap-2">
              {post.category && (
                <CategoryBadge
                  name={post.category.name}
                  icon={post.category.icon}
                  isRestricted={post.category.is_restricted}
                />
              )}
              {post.scope === 'org' && post.organization && (
                <Badge variant="outline" className="rounded-[7px] text-[11px] font-bold text-muted-foreground">
                  {post.organization.name}
                </Badge>
              )}
              {post.scope === 'global' && (
                <Badge variant="outline" className="rounded-[7px] text-[11px] font-bold text-muted-foreground">
                  {t('community.global')}
                </Badge>
              )}
              {post.is_pinned && <Pin aria-label={t('community.pinned')} className="h-4 w-4 text-primary" />}
              {post.is_locked && <Lock aria-label={t('community.locked')} className="h-4 w-4 text-[#9aa0af]" />}
              {post.is_hidden && (
                <span className="rounded-[7px] bg-[#fbf2dd] px-[11px] py-1 text-[11px] font-bold text-warning">
                  {t('community.hidden')}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-2.5 font-display text-[21px] font-extrabold tracking-[-0.01em]">{post.title}</h1>

          {/* Content */}
          <p className="mb-4 whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">{post.content}</p>

          {/* Event date/time/place chips */}
          {isEvent && post.event_date && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-[9px] text-[12.5px] font-bold text-accent-foreground">
                <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
                {format(new Date(post.event_date), 'EEEE, MMMM d, yyyy · h:mm a')}
              </span>
              {post.event_location && (
                <span className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-[9px] text-[12.5px] font-bold text-accent-foreground">
                  <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                  {post.event_location}
                </span>
              )}
              {post.event_registration_url && (
                <a
                  href={post.event_registration_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-[9px] text-[12.5px] font-bold text-primary hover:underline"
                >
                  <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('community.registerForEvent')}
                </a>
              )}
              {post.event_recording_url && (
                <a
                  href={post.event_recording_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-[9px] text-[12.5px] font-bold text-primary hover:underline"
                >
                  <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('community.watchRecording')}
                </a>
              )}
            </div>
          )}

          {/* Tags */}
          <TagList tags={post.tags || []} className="mb-4" />

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-[#eceef3] pt-3.5">
            <div className="flex items-center gap-2">
              {!isAuthor && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReportPost}
                  className="h-auto rounded-lg px-2 py-1.5 text-xs font-bold text-[#9aa0af] hover:bg-transparent hover:text-destructive"
                >
                  <Flag aria-hidden="true" className="h-[13px] w-[13px]" />
                  {t('community.report')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isAuthor && !isRestricted && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/app/community/${scope}/posts/${post.id}/edit`)}
                    className="h-auto rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-primary"
                  >
                    <Edit2 aria-hidden="true" className="h-[13px] w-[13px]" />
                    {t('common.edit')}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto rounded-lg px-2.5 py-1.5 text-xs font-bold text-destructive"
                      >
                        <Trash2 aria-hidden="true" className="h-[13px] w-[13px]" />
                        {t('common.delete')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('community.deletePostConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('community.deletePostConfirmDescription')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deletePostMutation.mutate()}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('common.delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
              {isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleHideMutation.mutate(!post.is_hidden)}
                    className="h-auto rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-primary"
                  >
                    {post.is_hidden ? (
                      <><Eye aria-hidden="true" className="h-[13px] w-[13px]" /> {t('community.show')}</>
                    ) : (
                      <><EyeOff aria-hidden="true" className="h-[13px] w-[13px]" /> {t('community.hide')}</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleLockMutation.mutate(!post.is_locked)}
                    className="h-auto rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground hover:text-primary"
                  >
                    {post.is_locked ? (
                      <><Unlock aria-hidden="true" className="h-[13px] w-[13px]" /> {t('community.unlock')}</>
                    ) : (
                      <><Lock aria-hidden="true" className="h-[13px] w-[13px]" /> {t('community.lock')}</>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Comments */}
        <CommentThread
          comments={comments}
          postId={postId!}
          currentUserId={profile?.id}
          isAdmin={isAdmin}
          isLocked={post.is_locked}
          isLoading={commentsLoading}
          highlightedCommentId={highlightedCommentId}
          onAddComment={async (content, parentId) => {
            await createCommentMutation.mutateAsync({ content, parentId });
          }}
          onEditComment={async (commentId, content) => {
            await updateCommentMutation.mutateAsync({ commentId, content });
          }}
          onDeleteComment={async (commentId) => {
            await deleteCommentMutation.mutateAsync(commentId);
          }}
          onReportComment={handleReportComment}
          onToggleHideComment={isAdmin ? async (commentId, hidden) => {
            await toggleCommentHideMutation.mutateAsync({ commentId, hidden });
          } : undefined}
        />

        {/* Report dialog */}
        <ReportDialog
          open={showReportDialog}
          onOpenChange={setShowReportDialog}
          onSubmit={async (reason) => {
            try {
              await reportMutation.mutateAsync(reason);
            } catch (error) {
              // Duplicate report: the report already exists, so this is terminal —
              // surface it as information and resolve the dialog (#21).
              if (error instanceof ApiError && error.status === 409) {
                toast({
                  title: t('community.alreadyReported'),
                  description: t('community.alreadyReportedDescription'),
                });
                return;
              }
              // Other failures: rethrow so the dialog stays open for a retry
              // (the mutation's onError already showed a destructive toast).
              throw error;
            }
          }}
          targetType={reportTargetType}
        />
      </div>
    </AppLayout>
  );
}
