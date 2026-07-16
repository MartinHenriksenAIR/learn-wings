import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Calendar, ExternalLink } from 'lucide-react';
import { format, isFuture, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CommunityPost } from '@/lib/community-types';

interface UpcomingEventsProps {
  events: CommunityPost[];
  onEventClick?: (event: CommunityPost) => void;
  className?: string;
}

export function UpcomingEvents({
  events,
  onEventClick,
  className,
}: UpcomingEventsProps) {
  const { t } = useTranslation();

  // Filter and sort upcoming events
  const upcomingEvents = events
    .filter((e) => e.event_date && (isFuture(new Date(e.event_date)) || isToday(new Date(e.event_date))))
    .sort((a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime())
    .slice(0, 3);

  if (upcomingEvents.length === 0) {
    return null;
  }

  return (
    <div className={cn('rounded-2xl border border-border bg-card px-5 py-[18px]', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13.5px] font-extrabold">
          <Calendar aria-hidden="true" className="h-[15px] w-[15px] text-primary" />
          {t('community.upcomingEvents')}
        </h3>
      </div>
      <div className="flex flex-col gap-3">
        {upcomingEvents.map((event) => {
          const eventDate = new Date(event.event_date!);
          const isEventToday = isToday(eventDate);

          return (
            <div
              key={event.id}
              className="flex cursor-pointer items-center gap-3"
              onClick={() => onEventClick?.(event)}
            >
              <span
                className={cn(
                  'flex h-[46px] w-[42px] shrink-0 flex-col items-center justify-center rounded-[11px] bg-accent',
                  isEventToday && 'bg-primary'
                )}
              >
                <span
                  className={cn(
                    'text-[10px] font-extrabold uppercase tracking-[0.05em]',
                    isEventToday ? 'text-primary-foreground' : 'text-primary'
                  )}
                >
                  {format(eventDate, 'MMM')}
                </span>
                <span
                  className={cn(
                    'text-base font-extrabold leading-none',
                    isEventToday ? 'text-primary-foreground' : 'text-primary'
                  )}
                >
                  {format(eventDate, 'd')}
                </span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-1 text-[12.5px] font-bold leading-[1.3]">{event.title}</span>
                <span className={cn('truncate text-[11.5px]', isEventToday ? 'font-semibold text-primary' : 'text-[#9aa0af]')}>
                  {isEventToday ? t('community.today') : format(eventDate, 'MMM d')}
                  {' · '}
                  {format(eventDate, 'h:mm a')}
                  {event.event_location && ` · ${event.event_location}`}
                </span>
              </span>
              {event.event_registration_url && (
                <a
                  href={event.event_registration_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-lg border-input px-2.5 text-[11px] font-bold"
                  >
                    <ExternalLink aria-hidden="true" className="mr-1 h-3 w-3" />
                    {t('community.register')}
                  </Button>
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
