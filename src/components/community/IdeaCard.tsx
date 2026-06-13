import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { IdeaStatusBadge } from './IdeaStatusBadge';
import { TagList } from './TagList';
import { MessageSquare, ThumbsUp, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { BUSINESS_AREAS } from '@/lib/community-types';
import type { EnhancedIdea } from '@/lib/community-types';
import { useAuth } from '@/hooks/useAuth';
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

interface IdeaCardProps {
  idea: EnhancedIdea;
  onClick?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function IdeaCard({ idea, onClick, onDelete, className }: IdeaCardProps) {
  const { t } = useTranslation();
  // profile.id (DB row UUID) is the ownership identity — user.id is the Entra OID.
  const { profile, effectiveIsOrgAdmin } = useAuth();

  const businessAreaLabel = idea.business_area
    ? BUSINESS_AREAS.find((b) => b.value === idea.business_area)?.label
    : null;

  const canDelete = effectiveIsOrgAdmin || idea.user_id === profile?.id;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={cn(
        'cursor-pointer rounded-2xl border border-border bg-card px-5 py-[18px] transition-shadow hover:shadow-[0_10px_28px_rgba(20,24,46,0.08)]',
        className
      )}
      onClick={onClick}
    >
      {/* Pills row */}
      <div className="mb-2.5 flex items-center gap-2">
        <IdeaStatusBadge status={idea.status} />
        {businessAreaLabel && (
          <span className="inline-flex items-center whitespace-nowrap rounded-[7px] bg-[#f3f4f8] px-[11px] py-1 text-[11px] font-bold text-[#686d7e]">
            {businessAreaLabel}
          </span>
        )}
        <div className="flex-1" />
        {canDelete && onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-[#9aa0af] hover:bg-[#fdf1f1] hover:text-destructive"
                onClick={handleDeleteClick}
              >
                <Trash2 aria-hidden="true" className="h-[13px] w-[13px]" />
                <span className="sr-only">{t('common.delete')}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent onClick={handleDeleteClick}>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('community.deleteIdeaTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('community.deleteIdeaDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Title + summary */}
      <h3 className="mb-1.5 line-clamp-2 text-[14.5px] font-bold leading-[1.35]">{idea.title}</h3>
      {(idea.description || idea.pain_points) && (
        <p className="mb-3 line-clamp-2 text-[12.5px] leading-normal text-muted-foreground">
          {idea.pain_points || idea.description}
        </p>
      )}

      <TagList tags={idea.tags || []} maxVisible={2} size="sm" className="mb-3" />

      {/* Footer: votes, comments, author · time */}
      <div className="flex items-center gap-3 text-xs text-[#9aa0af]">
        <span className="inline-flex items-center gap-[5px] font-semibold">
          <ThumbsUp aria-hidden="true" className="h-[13px] w-[13px]" />
          {idea.vote_count || 0}
        </span>
        <span className="inline-flex items-center gap-[5px] font-semibold">
          <MessageSquare aria-hidden="true" className="h-[13px] w-[13px]" />
          {idea.comment_count || 0}
        </span>
        <span className="min-w-0 truncate font-medium">
          {idea.profile?.full_name || t('community.unknownUser')}
          {' · '}
          {formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
