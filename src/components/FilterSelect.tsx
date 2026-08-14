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
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: FilterSelectOption[];
  className?: string;
}

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
