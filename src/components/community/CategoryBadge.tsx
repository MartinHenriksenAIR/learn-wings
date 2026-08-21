import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Lightbulb,
  AlertTriangle,
  Shield,
  HelpCircle,
  Trophy,
  FileText,
  Megaphone,
  Calendar,
  Lock,
  LucideIcon,
} from 'lucide-react';

interface CategoryBadgeProps {
  name: string;
  slug: string;
  icon?: string | null;
  isRestricted?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const iconMap: Record<string, LucideIcon> = {
  Lightbulb,
  AlertTriangle,
  Shield,
  HelpCircle,
  Trophy,
  FileText,
  Megaphone,
  Calendar,
};

const colorMap: Record<string, string> = {
  'challenges-obstacles': 'bg-amber-tint text-amber-deep',
  'risks-mitigation': 'bg-red-tint text-red-deep',
  'questions-help': 'bg-interactive-tint text-interactive',
  'wins-learnings': 'bg-green-tint text-green-deep',
  'announcements': 'bg-peri-pastel text-ink',
  'events': 'bg-peri-tint text-peri-deep',
};

export function CategoryBadge({
  name,
  slug,
  icon,
  isRestricted = false,
  size = 'md',
  className,
}: CategoryBadgeProps) {
  const Icon = icon ? iconMap[icon] : null;
  const colorClass = colorMap[slug] || 'bg-legacy-muted text-legacy-muted-foreground';

  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-[7px] border-transparent font-bold',
        colorClass,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-[11px] py-1 text-[11px]',
        className
      )}
    >
      {Icon && <Icon aria-hidden="true" className={cn('mr-1', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />}
      {name}
      {isRestricted && <Lock aria-hidden="true" className={cn('ml-1', size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3')} />}
    </Badge>
  );
}
