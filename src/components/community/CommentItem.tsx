import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MoreHorizontal, Reply, Edit2, Trash2, Flag, EyeOff, Eye, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
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
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const authorName = comment.profile?.full_name;
  const initials = getInitials(authorName);

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
        'flex gap-2.5 rounded-xl transition-colors',
        depth > 0 && 'ml-8 border-l-2 border-muted pl-4',
        comment.is_hidden && 'opacity-55',
        highlightedCommentId === comment.id && 'bg-accent/60'
      )}
    >
      <Avatar className="h-7 w-7 flex-shrink-0">
        <AvatarFallback
          className="text-[10px] font-bold text-white"
          style={{ backgroundColor: getAvatarColor(authorName) }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-bold">{authorName || t('community.unknownUser')}</span>
            <span className="text-[11px] text-[#9aa0af]">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
            {comment.is_hidden && (
              <span className="rounded-[7px] bg-[#fbf2dd] px-2 py-0.5 text-[10.5px] font-bold text-warning">
                {t('community.hidden')}
              </span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 rounded-lg p-0 text-[#9aa0af]">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReply && (
                <DropdownMenuItem onClick={() => onReply(comment.id)}>
                  <Reply className="h-4 w-4 mr-2" />
                  {t('community.reply')}
                </DropdownMenuItem>
              )}
              {canEdit && onEdit && (
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  {t('common.edit')}
                </DropdownMenuItem>
              )}
              {onReport && !isAuthor && (
                <DropdownMenuItem onClick={() => onReport(comment.id)}>
                  <Flag className="h-4 w-4 mr-2" />
                  {t('community.report')}
                </DropdownMenuItem>
              )}
              {onCopyLink && (
                <DropdownMenuItem onClick={() => onCopyLink(comment.id)}>
                  <Link2 className="h-4 w-4 mr-2" />
                  {t('community.copyLink')}
                </DropdownMenuItem>
              )}
              {isAdmin && onToggleHide && (
                <DropdownMenuItem onClick={() => onToggleHide(comment.id, !comment.is_hidden)}>
                  {comment.is_hidden ? (
                    <><Eye className="h-4 w-4 mr-2" /> {t('community.show')}</>
                  ) : (
                    <><EyeOff className="h-4 w-4 mr-2" /> {t('community.hide')}</>
                  )}
                </DropdownMenuItem>
              )}
              {canDelete && onDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(comment.id)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('common.delete')}
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
              className="min-h-[80px] rounded-[11px] text-[13px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveEdit} className="rounded-lg text-xs font-bold">
                {t('common.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(comment.content);
                }}
                className="rounded-lg text-xs font-bold"
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-[#4a4f60]">{comment.content}</p>
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
