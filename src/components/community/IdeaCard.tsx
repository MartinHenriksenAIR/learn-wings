import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { IdeaStatusBadge } from './IdeaStatusBadge';
import { TagList } from './TagList';
import { MessageSquare, ThumbsUp, Briefcase } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { BUSINESS_AREAS } from '@/lib/community-types';
import type { EnhancedIdea } from '@/lib/community-types';

interface IdeaCardProps {
  idea: EnhancedIdea;
  onClick?: () => void;
  className?: string;
}

export function IdeaCard({ idea, onClick, className }: IdeaCardProps) {
  const initials = idea.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const businessAreaLabel = idea.business_area 
    ? BUSINESS_AREAS.find((b) => b.value === idea.business_area)?.label 
    : null;

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
          <IdeaStatusBadge status={idea.status} size="sm" />
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
