import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface FilterSelectOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  /** Accessible name for the trigger — the filter bar carries no visible labels. */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: FilterSelectOption[];
  className?: string;
}

/**
 * A catalogue filter dropdown (category / level / status). A thin wrapper over the
 * shared shadcn `Select` so the filters render as the app's own dropdown instead of
 * the native browser/OS control (#429). Options are data-driven (the category list
 * depends on the catalogue), hence the array API. Styled to sit alongside the
 * rounded-xl `bg-card` search input on the same filter bar.
 */
export function FilterSelect({ label, value, onValueChange, options, className }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-auto w-auto cursor-pointer gap-2 rounded-xl bg-card py-[11px] pl-[13px] text-[13px] font-semibold text-[#2a2d3a] focus:border-primary focus:shadow-[0_0_0_3px_rgba(16,41,143,0.10)] focus:ring-0 focus:ring-offset-0',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
