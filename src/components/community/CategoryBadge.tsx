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
  'ideas-opportunities': 'bg-amber-100 text-amber-800',
  'challenges-obstacles': 'bg-orange-100 text-orange-800',
  'risks-mitigation': 'bg-red-100 text-red-800',
  'questions-help': 'bg-blue-100 text-blue-800',
  'wins-learnings': 'bg-green-100 text-green-800',
  'resources-templates': 'bg-purple-100 text-purple-800',
  'announcements': 'bg-pink-100 text-pink-800',
  'events': 'bg-indigo-100 text-indigo-800',
};

export function CategoryBadge({
  name,
  icon,
  isRestricted = false,
  size = 'md',
  className,
}: CategoryBadgeProps) {
  const Icon = icon ? iconMap[icon] : null;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const colorClass = colorMap[slug] || 'bg-muted text-muted-foreground';

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
