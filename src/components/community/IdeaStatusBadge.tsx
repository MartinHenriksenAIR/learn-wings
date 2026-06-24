import { cn } from '@/lib/utils';
import type { IdeaStatusExtended } from '@/lib/community-types';
import { IDEA_STATUS_OPTIONS } from '@/lib/community-types';

interface IdeaStatusBadgeProps {
  status: IdeaStatusExtended;
  size?: 'sm' | 'md';
  className?: string;
}

// Prototype `ST` map: squarer pills, tinted bg + strong fg per status.
const STATUS_STYLES: Partial<Record<IdeaStatusExtended, string>> = {
  draft: 'bg-[#f3f4f8] text-[#686d7e]',
  submitted: 'bg-accent text-accent-foreground',
  in_review: 'bg-[#fbf2dd] text-warning',
  accepted: 'bg-[#e7f6ef] text-success',
  in_progress: 'bg-[#e3f4f6] text-[#0f7e8a]',
  done: 'bg-[#e7f6ef] text-success',
  rejected: 'bg-[#fdecec] text-[#c43d3d]',
};

export function IdeaStatusBadge({
  status,
  size = 'md',
  className,
}: IdeaStatusBadgeProps) {
  const statusOption = IDEA_STATUS_OPTIONS.find((s) => s.value === status);

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-[7px] text-[11px] font-bold',
        size === 'sm' ? 'px-2.5 py-[3px]' : 'px-[11px] py-1',
        // Fallback for legacy status values keeps the neutral draft tint.
        STATUS_STYLES[status] ?? 'bg-[#f3f4f8] text-[#686d7e]',
        className
      )}
    >
      {statusOption?.label ?? status}
    </span>
  );
}
