import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isFuture, isToday } from 'date-fns';
import { Calendar, Loader2 } from 'lucide-react';
import { EventCard } from '@/components/community/EventCard';
import { useAuth } from '@/hooks/useAuth';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import type { CommunityPost } from '@/lib/community-types';

/**
 * The community "Events & Office Hours" tab (#125). A clean single column:
 * upcoming-only events (event_date today or later) merged from global scope
 * plus the user's current org, soonest first. Each event renders as a full
 * date-forward EventCard with a click-through to its post detail.
 */
export function EventsTab() {
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
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-5 py-12 text-center">
        <Calendar aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('community.noUpcomingEvents')}</p>
      </div>
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
