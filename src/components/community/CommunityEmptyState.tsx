import { Button } from '@/components/ui/button';
import { MessageSquare, Lightbulb, Users, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateVariant = 'posts' | 'ideas' | 'comments' | 'events' | 'reports';

interface CommunityEmptyStateProps {
  variant: EmptyStateVariant;
  scope?: 'org' | 'global';
  onAction?: () => void;
  actionLabel?: string;
  className?: string;
}

const variants: Record<EmptyStateVariant, { icon: typeof MessageSquare; title: string; description: string }> = {
  posts: {
    icon: MessageSquare,
    title: 'No posts yet',
    description: 'Be the first to start a discussion! Share ideas, ask questions, or post resources.',
  },
  ideas: {
    icon: Lightbulb,
    title: 'No ideas submitted',
    description: 'Submit your first AI or process optimization idea to help improve workflows.',
  },
  comments: {
    icon: MessageSquare,
    title: 'No comments yet',
    description: 'Be the first to share your thoughts on this post.',
  },
  events: {
    icon: Calendar,
    title: 'No upcoming events',
    description: 'Check back soon for upcoming events, webinars, and office hours.',
  },
  reports: {
    icon: Users,
    title: 'No reports to review',
    description: 'All clear! There are no pending content reports at this time.',
  },
};

export function CommunityEmptyState({
  variant,
  scope,
  onAction,
  actionLabel,
  className,
}: CommunityEmptyStateProps) {
  const config = variants[variant];
  const Icon = config.icon;

  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{config.title}</h3>
      <p className="text-muted-foreground max-w-sm mb-4">
        {config.description}
      </p>
      {onAction && actionLabel && (
        <Button onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
