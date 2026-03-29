import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CommentItem } from './CommentItem';
import { CommunityEmptyState } from './CommunityEmptyState';
import { toast } from '@/components/ui/sonner';
import { Loader2, Send } from 'lucide-react';
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
    <div className="space-y-6">
      <h3 className="font-semibold text-lg">
        Comments {comments.length > 0 && `(${comments.length})`}
      </h3>

      {/* Add comment form */}
      {!isLocked && currentUserId && (
        <div className="space-y-2">
          <Textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[80px]"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Comment
            </Button>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="bg-muted/50 rounded-md p-4 text-center text-muted-foreground">
          Comments are locked on this post.
        </div>
      )}

      {/* Reply form */}
      {replyingTo && (
        <div className="ml-8 border-l-2 border-primary pl-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Replying to comment...{' '}
            <button
              onClick={() => {
                setReplyingTo(null);
                setReplyContent('');
              }}
              className="text-primary hover:underline"
            >
              Cancel
            </button>
          </p>
          <Textarea
            placeholder="Write your reply..."
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            className="min-h-[60px]"
            autoFocus
          />
          <Button
            size="sm"
            onClick={handleReply}
            disabled={!replyContent.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Reply
          </Button>
        </div>
      )}

      {/* Comments list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : commentTree.length === 0 ? (
        <CommunityEmptyState variant="comments" />
      ) : (
        <div className="space-y-6">
          {commentTree.map((comment) => (
            <CommentItem
              key={comment.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
