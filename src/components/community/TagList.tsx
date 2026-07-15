import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TagListProps {
  tags: string[];
  className?: string;
  maxVisible?: number;
}

export function TagList({
  tags,
  className,
  maxVisible,
}: TagListProps) {
  const { t } = useTranslation();
  const visibleTags = maxVisible ? tags.slice(0, maxVisible) : tags;
  const hiddenCount = maxVisible ? Math.max(0, tags.length - maxVisible) : 0;

  if (tags.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {visibleTags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="rounded-[7px] border-transparent bg-accent px-2.5 py-[3px] text-[11.5px] font-semibold text-accent-foreground"
        >
          #{tag}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge variant="outline" className="rounded-[7px] px-2 py-[3px] text-[11px] font-semibold text-muted-foreground">
          {t('community.moreTags', { count: hiddenCount })}
        </Badge>
      )}
    </div>
  );
}
