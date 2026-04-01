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
};

const colorMap: Record<string, string> = {
  'ideas-opportunities': 'bg-amber-100 text-amber-800 border-amber-200',
  'challenges-obstacles': 'bg-orange-100 text-orange-800 border-orange-200',
  'risks-mitigation': 'bg-red-100 text-red-800 border-red-200',
  'questions-help': 'bg-blue-100 text-blue-800 border-blue-200',
  'wins-learnings': 'bg-green-100 text-green-800 border-green-200',
  'resources-templates': 'bg-purple-100 text-purple-800 border-purple-200',
  'announcements': 'bg-pink-100 text-pink-800 border-pink-200',
  
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
  const colorClass = colorMap[slug] || 'bg-muted text-muted-foreground border-border';

  return (
    <Badge
      variant="outline"
      className={cn(
        'font-medium border',
        colorClass,
        size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1',
        isRestricted && 'ring-1 ring-offset-1 ring-primary/20',
        className
      )}
    >
      {Icon && <Icon className={cn('mr-1', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />}
      {name}
    </Badge>
  );
}
