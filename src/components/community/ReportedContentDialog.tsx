import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CommentThread } from './CommentThread';
import { fetchPost, fetchComments } from '@/lib/community-api';
import { getAvatarColor, getInitials } from '@/lib/utils';
import { formatDate } from '@/lib/date-locale';
import { Loader2, Lock } from 'lucide-react';
import type { CommunityReport } from '@/lib/community-types';

interface ReportedContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: Pick<CommunityReport, 'target_type' | 'target_id' | 'post_id'> | null;
}

export function ReportedContentDialog({ open, onOpenChange, report }: ReportedContentDialogProps) {
  const { t, i18n } = useTranslation();

  const postId = report
    ? report.target_type === 'post'
      ? report.target_id
      : report.post_id ?? null
    : null;
  const highlightedCommentId = report?.target_type === 'comment' ? report.target_id : null;

  const { data: post, isLoading: postLoading } = useQuery({
    queryKey: queryKeys.communityPost.detail(postId ?? undefined),
    queryFn: () => fetchPost(postId!),
    enabled: open && !!postId,
  });

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: queryKeys.communityComments.list(postId ?? undefined),
    queryFn: () => fetchComments(postId!),
    enabled: open && !!postId,
  });

  useEffect(() => {
    if (!open || !highlightedCommentId || comments.length === 0) return;
    const el = document.getElementById(`comment-${highlightedCommentId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [open, highlightedCommentId, comments]);

  const authorName = post?.profile?.full_name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-[720px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('moderation.viewContentTitle')}</DialogTitle>
          <DialogDescription>{t('moderation.viewContentDescription')}</DialogDescription>
        </DialogHeader>

        {postLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-legacy-muted-foreground" />
          </div>
        ) : !post ? (
          <div className="py-10 text-center text-sm text-legacy-muted-foreground">
            {t('moderation.contentUnavailable')}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-legacy-2xl border border-legacy-border bg-legacy-card px-[22px] py-5">
              <div className="mb-3 flex items-center gap-2.5">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback
                    className="text-xs font-bold text-white"
                    style={{ backgroundColor: getAvatarColor(authorName) }}
                  >
                    {getInitials(authorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13.5px] font-bold">
                    {authorName || t('community.unknownUser')}
                  </span>
                  <span className="text-[11.5px] text-[#9aa0af]">
                    {formatDate(new Date(post.created_at), 'MMM d, yyyy · h:mm a', i18n.language)}
                  </span>
                </div>
                <div className="flex-1" />
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-[7px] text-[11px] font-bold text-legacy-muted-foreground"
                  >
                    {post.scope === 'org' && post.organization
                      ? post.organization.name
                      : t('community.global')}
                  </Badge>
                  {post.is_locked && (
                    <Lock aria-label={t('community.locked')} className="h-4 w-4 text-[#9aa0af]" />
                  )}
                  {post.is_hidden && (
                    <span className="rounded-[7px] bg-[#fbf2dd] px-[11px] py-1 text-[11px] font-bold text-legacy-warning">
                      {t('community.hidden')}
                    </span>
                  )}
                </div>
              </div>
              <h2 className="mb-2 font-display text-[19px] font-extrabold tracking-[-0.01em]">
                {post.title}
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-[1.65] text-[#4a4f60]">
                {post.content}
              </p>
            </div>

            <CommentThread
              comments={comments}
              postId={post.id}
              readOnly
              isLoading={commentsLoading}
              highlightedCommentId={highlightedCommentId}
              onAddComment={async () => {}}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
