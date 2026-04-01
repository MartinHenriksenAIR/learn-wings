import { useEffect, useState } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CategoryBadge } from '@/components/community/CategoryBadge';
import { TagList } from '@/components/community/TagList';
import { CommentThread } from '@/components/community/CommentThread';
import { ReportDialog } from '@/components/community/ReportDialog';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { toast } from '@/components/ui/sonner';
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
import type { CommunityScope } from '@/lib/community-types';

export default function PostDetail() {
  const { postId, scope: routeScope } = useParams<{ postId: string; scope: CommunityScope }>();
  const navigate = useNavigate();
  const scope = (routeScope || 'org') as CommunityScope;
  const { profile, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();
  const { features, isLoading: settingsLoading } = usePlatformSettings();
  const queryClient = useQueryClient();

  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<string>('');
  const [reportTargetType, setReportTargetType] = useState<'post' | 'comment'>('post');
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);

  // Fetch post
  const { data: post, isLoading: postLoading } = useQuery({
    queryKey: ['community-post', postId],
    queryFn: () => fetchPost(postId!),
    enabled: !!postId,
  });

  // Fetch comments
  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ['community-comments', postId],
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
      queryClient.invalidateQueries({ queryKey: ['community-comments', postId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to add comment', description: error.message, variant: 'destructive' });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      updateComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-comments', postId] });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-comments', postId] });
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
      queryClient.invalidateQueries({ queryKey: ['community-post', postId] });
    },
  });

  const toggleLockMutation = useMutation({
    mutationFn: (locked: boolean) => togglePostLocked(postId!, locked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-post', postId] });
    },
  });

  const toggleCommentHideMutation = useMutation({
    mutationFn: ({ commentId, hidden }: { commentId: string; hidden: boolean }) =>
      toggleCommentHidden(commentId, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-comments', postId] });
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

  if (!settingsLoading && !features.community_enabled) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (postLoading) {
    return (
      <AppLayout title="Post" breadcrumbs={[{ label: 'Community' }, { label: 'Post' }]}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!post) {
    return (
      <AppLayout title="Post Not Found" breadcrumbs={[{ label: 'Community' }]}>
        <div className="container mx-auto py-12 text-center">
          <h1 className="text-2xl font-bold mb-2">Post not found</h1>
          <p className="text-muted-foreground mb-4">This post may have been deleted or you don't have access.</p>
          <Button onClick={() => navigate(`/app/community?scope=${scope}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Community
          </Button>
        </div>
      </AppLayout>
    );
  }

  const initials = post.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  return (
    <AppLayout title={post.title} breadcrumbs={[{ label: 'Community' }, { label: 'Post' }]}>
      <div className="container mx-auto py-6 px-4 max-w-4xl">
        {/* Back button */}
        <Button
          variant="ghost"
          onClick={() => navigate(`/app/community?scope=${scope}`)}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Community
        </Button>

        {/* Post card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{post.profile?.full_name || 'Unknown User'}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(post.created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {post.is_pinned && <Pin className="h-4 w-4 text-primary" />}
                {post.is_locked && <Lock className="h-4 w-4 text-muted-foreground" />}
                {post.is_hidden && <Badge variant="outline">Hidden</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Category and scope */}
            <div className="flex items-center gap-2 flex-wrap">
              {post.category && (
                <CategoryBadge
                  name={post.category.name}
                  icon={post.category.icon}
                  isRestricted={post.category.is_restricted}
                />
              )}
              {post.scope === 'org' && post.organization && (
                <Badge variant="outline">{post.organization.name}</Badge>
              )}
              {post.scope === 'global' && (
                <Badge variant="outline">Global</Badge>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold">{post.title}</h1>

            {/* Content */}
            <div className="prose prose-sm max-w-none">
              <p className="whitespace-pre-wrap">{post.content}</p>
            </div>

            {/* Tags */}
            <TagList tags={post.tags || []} />

            <Separator />

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isAuthor && (
                  <Button variant="ghost" size="sm" onClick={handleReportPost}>
                    <Flag className="h-4 w-4 mr-1" />
                    Report
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
                    >
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this post?')) {
                          deletePostMutation.mutate();
                        }
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </>
                )}
                {isAdmin && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleHideMutation.mutate(!post.is_hidden)}
                    >
                      {post.is_hidden ? (
                        <><Eye className="h-4 w-4 mr-1" /> Show</>
                      ) : (
                        <><EyeOff className="h-4 w-4 mr-1" /> Hide</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleLockMutation.mutate(!post.is_locked)}
                    >
                      {post.is_locked ? (
                        <><Unlock className="h-4 w-4 mr-1" /> Unlock</>
                      ) : (
                        <><Lock className="h-4 w-4 mr-1" /> Lock</>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Comments */}
        <Card>
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>

        {/* Report dialog */}
        <ReportDialog
          open={showReportDialog}
          onOpenChange={setShowReportDialog}
          onSubmit={async (reason) => {
            await reportMutation.mutateAsync(reason);
          }}
          targetType={reportTargetType}
        />
      </div>
    </AppLayout>
  );
}
