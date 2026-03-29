import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, Reply, Edit2, Trash2, Flag, EyeOff, Eye, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CommunityComment } from '@/lib/community-types';

interface CommentItemProps {
  comment: CommunityComment;
  currentUserId?: string;
  isAdmin?: boolean;
  onReply?: (parentId: string) => void;
  onEdit?: (commentId: string, content: string) => void;
  onDelete?: (commentId: string) => void;
  onReport?: (commentId: string) => void;
  onToggleHide?: (commentId: string, hidden: boolean) => void;
  onCopyLink?: (commentId: string) => void;
  highlightedCommentId?: string | null;
  depth?: number;
}

export function CommentItem({
  comment,
  currentUserId,
  isAdmin = false,
  onReply,
  onEdit,
  onDelete,
  onReport,
  onToggleHide,
  onCopyLink,
  highlightedCommentId = null,
  depth = 0,
}: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const initials = comment.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const isAuthor = currentUserId === comment.user_id;
  const canEdit = isAuthor && !comment.is_hidden;
  const canDelete = isAuthor || isAdmin;

  const handleSaveEdit = () => {
    if (editContent.trim() && onEdit) {
      onEdit(comment.id, editContent.trim());
      setIsEditing(false);
    }
  };

  return (
    <div
      id={`comment-${comment.id}`}
      className={cn(
        'flex gap-3 rounded-md transition-colors',
        depth > 0 && 'ml-8 border-l-2 border-muted pl-4',
        comment.is_hidden && 'opacity-60',
        highlightedCommentId === comment.id && 'bg-accent/20'
      )}
    >
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className="bg-muted text-muted-foreground text-xs">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{comment.profile?.full_name || 'Unknown User'}</span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
            {comment.is_hidden && (
              <Badge variant="outline" className="text-xs">Hidden</Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReply && (
                <DropdownMenuItem onClick={() => onReply(comment.id)}>
                  <Reply className="h-4 w-4 mr-2" />
                  Reply
                </DropdownMenuItem>
              )}
              {canEdit && onEdit && (
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              {onReport && !isAuthor && (
                <DropdownMenuItem onClick={() => onReport(comment.id)}>
                  <Flag className="h-4 w-4 mr-2" />
                  Report
                </DropdownMenuItem>
              )}
              {onCopyLink && (
                <DropdownMenuItem onClick={() => onCopyLink(comment.id)}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Copy link
                </DropdownMenuItem>
              )}
              {isAdmin && onToggleHide && (
                <DropdownMenuItem onClick={() => onToggleHide(comment.id, !comment.is_hidden)}>
                  {comment.is_hidden ? (
                    <><Eye className="h-4 w-4 mr-2" /> Show</>
                  ) : (
                    <><EyeOff className="h-4 w-4 mr-2" /> Hide</>
                  )}
                </DropdownMenuItem>
              )}
              {canDelete && onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(comment.id)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[80px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveEdit}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(comment.content);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground whitespace-pre-wrap">{comment.content}</p>
        )}

        {/* Nested replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-4 space-y-4">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onReport={onReport}
                onToggleHide={onToggleHide}
                onCopyLink={onCopyLink}
                highlightedCommentId={highlightedCommentId}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
