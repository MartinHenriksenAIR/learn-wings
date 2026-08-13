import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { BrandingAvatar } from '@/components/ui/branding-avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDistanceToNowLocalized } from '@/lib/date-locale';
import { SectionHeading, SeeMore } from './section';
import { DASH_ACCENTS } from './palette';
import type { CommunityPost } from '@/lib/community-types';

interface DashboardCommunityProps {
  posts: CommunityPost[];
  onPostClick: (post: CommunityPost) => void;
  onSeeMore: () => void;
}

/**
 * The community glance: unboxed rows on the canvas, separated by hairlines.
 * The post's own anatomy does the work — author avatar, name, relative time,
 * scope chip, title, a two-line snippet and the comment count. There is no
 * reactions table, so the count is the only engagement figure we can show.
 */
export function DashboardCommunity({ posts, onPostClick, onSeeMore }: DashboardCommunityProps) {
  const { t, i18n } = useTranslation();

  return (
    <section className="mt-[30px]" data-testid="dashboard-community">
      <SectionHeading>{t('dashboard.community.title')}</SectionHeading>

      {posts.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title={t('dashboard.community.noActivityTitle')}
          description={t('dashboard.community.noActivityDescription')}
          // Borderless with a soft shadow, like every other card on this surface.
          className="border-0 p-10 shadow-[0_2px_5px_rgba(17,20,45,0.045)]"
        />
      ) : (
        posts.map((post, i) => (
          <div
            key={post.id}
            role="button"
            tabIndex={0}
            onClick={() => onPostClick(post)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPostClick(post);
              }
            }}
            className="flex min-w-0 cursor-pointer items-start gap-[13px] px-1 py-[15px] [&+&]:border-t [&+&]:border-[rgba(23,26,38,0.07)]"
          >
            <BrandingAvatar
              avatarPath={post.profile?.avatar_url}
              name={post.profile?.full_name}
              className="h-[34px] w-[34px] shrink-0"
              fallbackClassName="text-[11.5px] font-extrabold text-dash-ink"
              // BrandingAvatar derives a per-name colour and applies it inline,
              // which would beat a class — so the accent goes in as a style.
              fallbackStyle={{ backgroundColor: DASH_ACCENTS[i % DASH_ACCENTS.length] }}
            />
            <div className="min-w-0 flex-1">
              <div className="mb-[5px] flex min-w-0 items-center gap-[7px]">
                <span className="truncate text-[12.5px] font-bold">
                  {post.profile?.full_name || t('community.unknownUser')}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  · {formatDistanceToNowLocalized(new Date(post.created_at), i18n.language)}
                </span>
                <span className="ml-auto shrink-0 rounded-md bg-[rgba(23,26,38,0.055)] px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                  {post.scope === 'org' ? t('dashboard.community.scopeOrg') : t('dashboard.community.scopeGlobal')}
                </span>
              </div>
              <div className="mb-[3px] text-[14.5px] font-bold leading-[1.3] tracking-[-0.01em]">{post.title}</div>
              <p className="mb-[9px] line-clamp-2 text-[12.5px] leading-[1.5] text-muted-foreground">{post.content}</p>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                {t('dashboard.community.comments', { count: post.comment_count ?? 0 })}
              </span>
            </div>
          </div>
        ))
      )}

      <SeeMore onClick={onSeeMore} />
    </section>
  );
}
