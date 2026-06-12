import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageSpinnerProps {
  className?: string;
}

/**
 * The standard full-page loading block rendered inside an `AppLayout` while a
 * page's data (or auth context) resolves. Extracted from the block that was
 * copy-pasted across 10+ pages (#87).
 */
export function PageSpinner({ className }: PageSpinnerProps) {
  return (
    <div className={cn('flex h-64 items-center justify-center', className)}>
      <Loader2 className="h-8 w-8 animate-spin text-accent" />
    </div>
  );
}
