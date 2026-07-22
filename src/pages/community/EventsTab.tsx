import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isFuture, isToday } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { EventCard } from '@/components/community/EventCard';
import { CommunityEmptyState } from '@/components/community/CommunityEmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import type { CommunityPost } from '@/lib/community-types';

interface EventsTabProps {
  /** Admins get the New Event CTA on the empty state; learners get the message only. */
  canCreateEvent?: boolean;
  /** Opens the events-preselected PostForm — same action as the header New Event button. */
  onNewEvent?: () => void;
}

/**
 * The community "Events & Office Hours" tab (#125). A clean single column:
 * upcoming-only events (event_date today or later) merged from global scope
 * plus the user's current org, soonest first. Each event renders as a full
 * date-forward EventCard with a click-through to its post detail.
 */
export function EventsTab({ canCreateEvent = false, onNewEvent }: EventsTabProps) {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();

  const globalQuery = useCommunityEvents('global', currentOrg?.id);
  const orgQuery = useCommunityEvents('org', currentOrg?.id);

  const isLoading = globalQuery.isLoading || orgQuery.isLoading;

  // Merge global + org, keep only events-category posts that are today or in
  // the future, soonest first — same semantics as UpcomingEvents.tsx.
  const events = useMemo<CommunityPost[]>(() => {
    const merged = [...(globalQuery.data ?? []), ...(orgQuery.data ?? [])];
    return merged
      .filter((e) => e.category?.slug === 'events')
      .filter(
        (e) =>
          e.event_date &&
          (isFuture(new Date(e.event_date)) || isToday(new Date(e.event_date))),
      )
      .sort(
        (a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime(),
      );
  }, [globalQuery.data, orgQuery.data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <CommunityEmptyState
        variant="events"
        onAction={canCreateEvent ? onNewEvent : undefined}
        actionLabel={canCreateEvent ? t('community.newEvent') : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
