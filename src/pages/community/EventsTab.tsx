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
  canCreateEvent?: boolean;
  onNewEvent?: () => void;
}

export function EventsTab({ canCreateEvent = false, onNewEvent }: EventsTabProps) {
  const { t } = useTranslation();
  const { currentOrg } = useAuth();

  const orgIdForEvents = currentOrg?.kind === 'individual' ? undefined : currentOrg?.id;

  const globalQuery = useCommunityEvents('global', currentOrg?.id);
  const orgQuery = useCommunityEvents('org', orgIdForEvents);

  const isLoading = globalQuery.isLoading || orgQuery.isLoading;

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
        <Loader2 className="h-8 w-8 animate-spin text-legacy-muted-foreground" />
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
