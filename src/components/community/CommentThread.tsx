import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CommentItem } from './CommentItem';
import { CommunityEmptyState } from './CommunityEmptyState';
import { toast } from '@/components/ui/sonner';
import { Loader2, Lock, Send } from 'lucide-react';
import type { CommunityComment } from '@/lib/community-types';

interface CommentThreadProps {
  comments: CommunityComment[];
  postId: string;
  currentUserId?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
  isLoading?: boolean;
  highlightedCommentId?: string | null;
  onAddComment: (content: string, parentId?: string) => Promise<void>;
  onEditComment?: (commentId: string, content: string) => Promise<void>;
  onDeleteComment?: (commentId: string) => Promise<void>;
  onReportComment?: (commentId: string) => void;
  onToggleHideComment?: (commentId: string, hidden: boolean) => Promise<void>;
}

export function CommentThread({
  comments,
  postId,
  currentUserId,
  isAdmin = false,
  isLocked = false,
  isLoading = false,
  highlightedCommentId = null,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onReportComment,
  onToggleHideComment,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Build nested comment tree
  const buildTree = (comments: CommunityComment[]): CommunityComment[] => {
    const map = new Map<string, CommunityComment>();
    const roots: CommunityComment[] = [];

    comments.forEach((c) => {
      map.set(c.id, { ...c, replies: [] });
    });

    comments.forEach((c) => {
      const comment = map.get(c.id)!;
      if (c.parent_comment_id && map.has(c.parent_comment_id)) {
        const parent = map.get(c.parent_comment_id)!;
        parent.replies = parent.replies || [];
        parent.replies.push(comment);
      } else {
        roots.push(comment);
      }
    });

    return roots;
  };

  const commentTree = buildTree(comments);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setIsSubmitting(true);
    try {
      await onAddComment(newComment.trim());
      setNewComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!replyContent.trim() || !replyingTo) return;
    setIsSubmitting(true);
    try {
      await onAddComment(replyContent.trim(), replyingTo);
      setReplyContent('');
      setReplyingTo(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (commentId: string, content: string) => {
    if (onEditComment) {
      await onEditComment(commentId, content);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (onDeleteComment) {
      await onDeleteComment(commentId);
    }
  };

  const handleCopyCommentLink = async (commentId: string) => {
    const commentUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#comment-${commentId}`;
    await navigator.clipboard.writeText(commentUrl);
    toast({ title: 'Comment link copied' });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-extrabold">
        {t('community.comments')} {comments.length > 0 && `(${comments.length})`}
      </h3>

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : commentTree.length === 0 ? (
        <CommunityEmptyState variant="comments" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {commentTree.map((comment) => (
            <div key={comment.id} className="rounded-[14px] border border-border bg-card px-[18px] py-3.5">
              <CommentItem
                comment={comment}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onReply={isLocked ? undefined : (parentId) => setReplyingTo(parentId)}
                onEdit={onEditComment ? handleEdit : undefined}
                onDelete={onDeleteComment ? handleDelete : undefined}
                onReport={onReportComment}
                onToggleHide={onToggleHideComment}
                onCopyLink={handleCopyCommentLink}
                highlightedCommentId={highlightedCommentId}
              />
            </div>
          ))}
        </div>
      )}

      {/* Reply form */}
      {replyingTo && (
        <div className="ml-8 space-y-2 border-l-2 border-primary pl-4">
          <p className="text-[13px] text-muted-foreground">
            {t('community.replyingTo')}{' '}
            <button
              onClick={() => {
                setReplyingTo(null);
                setReplyContent('');
              }}
              className="font-semibold text-primary hover:underline"
            >
              {t('common.cancel')}
            </button>
          </p>
          <Textarea
            placeholder={t('community.writeReplyPlaceholder')}
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            className="min-h-[60px] rounded-[11px] text-[13px]"
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleReply}
            disabled={!replyContent.trim() || isSubmitting}
            className="rounded-[10px] text-[13px] font-bold"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {t('community.reply')}
          </Button>
        </div>
      )}

      {/* Locked banner */}
      {isLocked && (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-[#efddb2] bg-[#fbf2dd] px-[18px] py-3.5 text-[13px] font-semibold text-[#8a5e10]">
          <Lock aria-hidden="true" className="h-[15px] w-[15px] shrink-0" />
          {t('community.commentsLocked')}
        </div>
      )}

      {/* Add comment composer */}
      {!isLocked && currentUserId && (
        <div className="flex items-end gap-2.5 rounded-2xl border border-border bg-card p-4">
          <Textarea
            placeholder={t('community.addCommentPlaceholder')}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[56px] flex-1 rounded-[11px] text-[13px]"
          />
          <Button
            onClick={handleSubmit}
            disabled={!newComment.trim() || isSubmitting}
            className="rounded-[10px] px-[18px] text-[13px] font-bold"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {t('community.comment')}
          </Button>
        </div>
      )}
    </div>
  );
}
