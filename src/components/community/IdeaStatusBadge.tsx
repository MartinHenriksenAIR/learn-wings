import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { IdeaStatusExtended } from '@/lib/community-types';
import { IDEA_STATUS_OPTIONS } from '@/lib/community-types';

interface IdeaStatusBadgeProps {
  status: IdeaStatusExtended;
  size?: 'sm' | 'md';
  className?: string;
}

export function IdeaStatusBadge({
  status,
  size = 'md',
  className,
}: IdeaStatusBadgeProps) {
  const statusOption = IDEA_STATUS_OPTIONS.find((s) => s.value === status);
  
  if (!statusOption) {
    // Fallback for legacy status values
    return (
      <Badge variant="outline" className={cn(size === 'sm' && 'text-xs', className)}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn(
        'font-medium border',
        statusOption.color,
        size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-sm px-2 py-0.5',
        className
      )}
    >
      {statusOption.label}
    </Badge>
  );
}
