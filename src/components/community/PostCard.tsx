import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './CategoryBadge';
import { TagList } from './TagList';
import { MessageSquare, Pin, Lock, Eye, EyeOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CommunityPost } from '@/lib/community-types';

interface PostCardProps {
  post: CommunityPost;
  onClick?: () => void;
  isAdmin?: boolean;
  onToggleHide?: (postId: string, hidden: boolean) => void;
  onToggleLock?: (postId: string, locked: boolean) => void;
}

export function PostCard({
  post,
  onClick,
  isAdmin = false,
  onToggleHide,
  onToggleLock,
}: PostCardProps) {
  const initials = post.profile?.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  const isAnnouncement = post.category?.slug === 'announcements';

  return (
    <Card
      className={cn(
        'transition-colors hover:bg-accent/50 cursor-pointer',
        isAnnouncement && 'border-l-4 border-l-pink-500',
        post.is_pinned && 'border-l-4 border-l-primary',
        post.is_hidden && 'opacity-60'
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-primary text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-sm">{post.profile?.full_name || 'Unknown User'}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {post.is_pinned && (
              <Pin className="h-4 w-4 text-primary" />
            )}
            {post.is_locked && (
              <Lock className="h-4 w-4 text-muted-foreground" />
            )}
            {post.is_hidden && (
              <Badge variant="outline" className="text-xs">Hidden</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {post.category && (
            <CategoryBadge
              name={post.category.name}
              icon={post.category.icon}
              isRestricted={post.category.is_restricted}
              size="sm"
            />
          )}
          {post.scope === 'org' && post.organization && (
            <Badge variant="outline" className="text-xs">
              {post.organization.name}
            </Badge>
          )}
        </div>

        <h3 className="font-semibold text-base line-clamp-2">{post.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>

        <div className="flex items-center justify-between pt-2">
          <TagList tags={post.tags} maxVisible={3} size="sm" />
          <div className="flex items-center gap-3 text-muted-foreground text-sm">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              {post.comment_count || 0}
            </span>
          </div>
        </div>

        {isAdmin && (onToggleHide || onToggleLock) && (
          <div
            className="flex items-center gap-2 pt-2 border-t"
            onClick={(e) => e.stopPropagation()}
          >
            {onToggleHide && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleHide(post.id, !post.is_hidden)}
              >
                {post.is_hidden ? (
                  <><Eye className="h-4 w-4 mr-1" /> Show</>
                ) : (
                  <><EyeOff className="h-4 w-4 mr-1" /> Hide</>
                )}
              </Button>
            )}
            {onToggleLock && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleLock(post.id, !post.is_locked)}
              >
                {post.is_locked ? 'Unlock' : 'Lock Comments'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
