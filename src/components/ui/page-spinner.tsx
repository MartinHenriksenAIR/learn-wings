import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageSpinnerProps {
  className?: string;
}

export function PageSpinner({ className }: PageSpinnerProps) {
  return (
    <div className={cn('flex h-64 items-center justify-center', className)}>
      <Loader2 className="h-8 w-8 animate-spin text-legacy-accent" />
    </div>
  );
}
