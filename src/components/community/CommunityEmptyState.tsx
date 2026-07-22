import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { MessageSquare, Lightbulb, FileEdit, FolderOpen, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateVariant = 'posts' | 'ideas' | 'comments' | 'drafts' | 'resources' | 'events';

interface CommunityEmptyStateProps {
  variant: EmptyStateVariant;
  onAction?: () => void;
  actionLabel?: string;
  hasActiveFilters?: boolean;
  filterDescription?: string;
  onClearFilters?: () => void;
  className?: string;
}

const variants: Record<EmptyStateVariant, { icon: typeof MessageSquare; titleKey: string; descriptionKey: string }> = {
  posts: {
    icon: MessageSquare,
    titleKey: 'community.emptyState.postsTitle',
    descriptionKey: 'community.emptyState.postsDescription',
  },
  ideas: {
    icon: Lightbulb,
    titleKey: 'community.emptyState.ideasTitle',
    descriptionKey: 'community.emptyState.ideasDescription',
  },
  drafts: {
    icon: FileEdit,
    titleKey: 'community.emptyState.draftsTitle',
    descriptionKey: 'community.emptyState.draftsDescription',
  },
  comments: {
    icon: MessageSquare,
    titleKey: 'community.emptyState.commentsTitle',
    descriptionKey: 'community.emptyState.commentsDescription',
  },
  resources: {
    icon: FolderOpen,
    titleKey: 'community.emptyState.resourcesTitle',
    descriptionKey: 'community.emptyState.resourcesDescription',
  },
  events: {
    icon: Calendar,
    titleKey: 'community.emptyState.eventsTitle',
    descriptionKey: 'community.emptyState.eventsDescription',
  },
};

export function CommunityEmptyState({
  variant,
  onAction,
  actionLabel,
  hasActiveFilters = false,
  filterDescription,
  onClearFilters,
  className,
}: CommunityEmptyStateProps) {
  const { t } = useTranslation();
  const config = variants[variant];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#d6d8e0] bg-card p-12 text-center',
        className
      )}
    >
      <div className="mb-4 rounded-full bg-muted p-4">
        <Icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mb-1 text-[15px] font-bold">{t(config.titleKey)}</h3>
      <p className="mb-4 max-w-sm text-[13px] text-[#9aa0af]">
        {hasActiveFilters
          ? filterDescription || t('community.emptyState.noMatches')
          : t(config.descriptionKey)}
      </p>
      {hasActiveFilters && onClearFilters && (
        <Button variant="outline" onClick={onClearFilters} className="mb-3 rounded-[10px] text-[13px] font-bold">
          {t('community.emptyState.clearFilters')}
        </Button>
      )}
      {onAction && actionLabel && (
        <Button onClick={onAction} className="rounded-[10px] text-[13px] font-bold">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
