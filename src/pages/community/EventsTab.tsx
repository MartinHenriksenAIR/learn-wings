import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isFuture, isToday } from 'date-fns';
import { Calendar, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import { formatDate } from '@/lib/date-locale';
import type { CommunityPost } from '@/lib/community-types';

/**
 * The community "Events & Office Hours" tab (#125) — the thin end-to-end
 * tracer. A clean single column: upcoming-only events (event_date today or
 * later) merged from global scope plus the user's current org, soonest first.
 * Each row is deliberately minimal — title, date/time, and a Join link — the
 * full event card is a follow-up.
 */
export function EventsTab() {
  const { t, i18n } = useTranslation();
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
      {events.map((event) => {
        const eventDate = new Date(event.event_date!);
        return (
          <div
            key={event.id}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[14px] font-bold">{event.title}</span>
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
                {isToday(eventDate) ? t('community.today') : formatDate(eventDate, 'PPP', i18n.language)}
                {' · '}
                {formatDate(eventDate, 'p', i18n.language)}
                {event.event_location && ` · ${event.event_location}`}
              </span>
            </div>
            {event.event_registration_url && (
              <a
                href={event.event_registration_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg border-input px-3 text-[12px] font-bold"
                >
                  <ExternalLink aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                  {t('community.join')}
                </Button>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
