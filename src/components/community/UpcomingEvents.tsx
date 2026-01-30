import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, MapPin, ExternalLink, ArrowRight } from 'lucide-react';
import { format, isFuture, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import type { CommunityPost } from '@/lib/community-types';

interface UpcomingEventsProps {
  events: CommunityPost[];
  onViewAll?: () => void;
  onEventClick?: (event: CommunityPost) => void;
  maxVisible?: number;
  className?: string;
}

export function UpcomingEvents({
  events,
  onViewAll,
  onEventClick,
  maxVisible = 3,
  className,
}: UpcomingEventsProps) {
  // Filter and sort upcoming events
  const upcomingEvents = events
    .filter((e) => e.event_date && (isFuture(new Date(e.event_date)) || isToday(new Date(e.event_date))))
    .sort((a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime())
    .slice(0, maxVisible);

  if (upcomingEvents.length === 0) {
    return null;
  }

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Upcoming Events
          </CardTitle>
          {onViewAll && events.length > maxVisible && (
            <Button variant="ghost" size="sm" onClick={onViewAll}>
              View all
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {upcomingEvents.map((event) => {
          const eventDate = new Date(event.event_date!);
          const isEventToday = isToday(eventDate);

          return (
            <div
              key={event.id}
              className={cn(
                'p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer',
                isEventToday && 'border-primary bg-primary/5'
              )}
              onClick={() => onEventClick?.(event)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 flex-1 min-w-0">
                  <h4 className="font-medium text-sm line-clamp-1">{event.title}</h4>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className={cn(
                      'flex items-center gap-1',
                      isEventToday && 'text-primary font-medium'
                    )}>
                      <Calendar className="h-3 w-3" />
                      {isEventToday ? 'Today' : format(eventDate, 'MMM d')}
                      {', '}
                      {format(eventDate, 'h:mm a')}
                    </span>
                    {event.event_location && (
                      <span className="flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{event.event_location}</span>
                      </span>
                    )}
                  </div>
                </div>
                {event.event_registration_url && (
                  <a
                    href={event.event_registration_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Register
                    </Button>
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
