import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IdeaStatusBadge } from './IdeaStatusBadge';
import { TagList } from './TagList';
import { MessageSquare, ThumbsUp, Briefcase, Trash2 } from 'lucide-react';
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
  const { user, effectiveIsOrgAdmin } = useAuth();
  
  const initials = idea.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const businessAreaLabel = idea.business_area 
    ? BUSINESS_AREAS.find((b) => b.value === idea.business_area)?.label 
    : null;

  const canDelete = effectiveIsOrgAdmin || idea.user_id === user?.id;

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <Card
      className={cn(
        'transition-colors hover:bg-accent/50 cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-amber-100 text-amber-800 text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-sm">{idea.profile?.full_name || 'Unknown User'}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(idea.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IdeaStatusBadge status={idea.status} size="sm" />
            {canDelete && onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={handleDeleteClick}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={handleDeleteClick}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Idea</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this idea? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <h3 className="font-semibold text-base line-clamp-2">{idea.title}</h3>
        
        {(idea.description || idea.pain_points) && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {idea.pain_points || idea.description}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {businessAreaLabel && (
            <Badge variant="outline" className="text-xs">
              <Briefcase className="h-3 w-3 mr-1" />
              {businessAreaLabel}
            </Badge>
          )}
          <TagList tags={idea.tags || []} maxVisible={2} size="sm" />
        </div>

        <div className="flex items-center gap-4 text-muted-foreground text-sm pt-2">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {idea.comment_count || 0}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-4 w-4" />
            {idea.vote_count || 0}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
