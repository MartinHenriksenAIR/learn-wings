import { useTranslation } from 'react-i18next';
import { BrandingAvatar } from '@/components/ui/branding-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from './CategoryBadge';
import { TagList } from './TagList';
import { MessageSquare, Pin, Lock, Calendar, MapPin, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { formatDate, formatDistanceToNowLocalized } from '@/lib/date-locale';
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
  const { t, i18n } = useTranslation();
  const authorName = post.profile?.full_name;

  const isEvent = post.category?.slug === 'events';

  return (
    <div
      className={cn(
        'cursor-pointer rounded-2xl border border-border bg-card px-5 py-[18px] transition-shadow hover:shadow-[0_10px_28px_rgba(20,24,46,0.08)]',
        post.is_hidden && 'opacity-55'
      )}
      onClick={onClick}
    >
      {/* Author row */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <BrandingAvatar
          avatarPath={post.profile?.avatar_url}
          name={authorName}
          className="h-[34px] w-[34px] shrink-0"
          fallbackClassName="text-[11.5px] font-bold text-white"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-bold">{authorName || t('community.unknownUser')}</span>
          <span className="text-[11.5px] text-[#9aa0af]">
            {formatDistanceToNowLocalized(new Date(post.created_at), i18n.language)}
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          {post.category && (
            <CategoryBadge
              name={post.category.name}
              icon={post.category.icon}
              isRestricted={post.category.is_restricted}
              size="sm"
            />
          )}
          {post.scope === 'org' && post.organization && (
            <Badge variant="outline" className="rounded-[7px] text-[11px] font-bold text-muted-foreground">
              {post.organization.name}
            </Badge>
          )}
          {post.is_pinned && (
            <Pin aria-label={t('community.pinned')} className="h-4 w-4 text-primary" />
          )}
          {post.is_locked && (
            <Lock aria-label={t('community.locked')} className="h-4 w-4 text-[#9aa0af]" />
          )}
          {post.is_hidden && (
            <span className="rounded-[7px] bg-[#fbf2dd] px-[11px] py-1 text-[11px] font-bold text-warning">
              {t('community.hidden')}
            </span>
          )}
        </div>
      </div>

      <h3 className="mb-1.5 line-clamp-2 text-[15px] font-bold leading-[1.35]">{post.title}</h3>
      <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{post.content}</p>

      {/* Event date/time/place chips */}
      {isEvent && post.event_date && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-[7px] text-xs font-bold text-accent-foreground">
            <Calendar aria-hidden="true" className="h-[13px] w-[13px]" />
            {formatDate(new Date(post.event_date), 'MMM d, h:mm a', i18n.language)}
          </span>
          {post.event_location && (
            <span className="inline-flex max-w-[220px] items-center gap-2 rounded-lg bg-accent px-3 py-[7px] text-xs font-bold text-accent-foreground">
              <MapPin aria-hidden="true" className="h-[13px] w-[13px] shrink-0" />
              <span className="truncate">{post.event_location}</span>
            </span>
          )}
          {post.event_registration_url && (
            <a
              href={post.event_registration_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-[7px] text-xs font-bold text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
              {t('community.register')}
            </a>
          )}
        </div>
      )}

      {/* Footer: comment count + tags */}
      <div className="flex items-center gap-3.5">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#9aa0af]">
          <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
          {post.comment_count || 0}
        </span>
        <div className="flex-1" />
        <TagList tags={post.tags} maxVisible={3} />
      </div>

      {/* Admin controls */}
      {isAdmin && (onToggleHide || onToggleLock) && (
        <div
          className="mt-3 flex items-center gap-2 border-t border-border pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {onToggleHide && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleHide(post.id, !post.is_hidden)}
              className="h-auto rounded-lg border-input px-3 py-[7px] text-xs font-bold"
            >
              {post.is_hidden ? (
                <><Eye aria-hidden="true" className="mr-1 h-4 w-4" /> {t('community.show')}</>
              ) : (
                <><EyeOff aria-hidden="true" className="mr-1 h-4 w-4" /> {t('community.hide')}</>
              )}
            </Button>
          )}
          {onToggleLock && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleLock(post.id, !post.is_locked)}
              className="h-auto rounded-lg border-input px-3 py-[7px] text-xs font-bold"
            >
              {post.is_locked ? t('community.unlock') : t('community.lockComments')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
