import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagListProps {
  tags: string[];
  onRemove?: (tag: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  maxVisible?: number;
}

export function TagList({
  tags,
  onRemove,
  size = 'sm',
  className,
  maxVisible,
}: TagListProps) {
  const visibleTags = maxVisible ? tags.slice(0, maxVisible) : tags;
  const hiddenCount = maxVisible ? Math.max(0, tags.length - maxVisible) : 0;

  if (tags.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {visibleTags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className={cn(
            'font-normal',
            size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2 py-0.5',
            onRemove && 'pr-1'
          )}
        >
          #{tag}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(tag)}
              className="ml-1 hover:text-destructive focus:outline-none"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge variant="outline" className="text-xs px-1.5 py-0 font-normal">
          +{hiddenCount} more
        </Badge>
      )}
    </div>
  );
}
