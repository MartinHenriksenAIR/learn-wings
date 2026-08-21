import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, ExternalLink } from 'lucide-react';
import { isToday } from 'date-fns';
import { formatDate } from '@/lib/date-locale';
import { routes } from '@/lib/routes';
import { safeHref } from '@/lib/safe-href';
import { cn } from '@/lib/utils';
import type { CommunityPost } from '@/lib/community-types';

interface EventCardProps {
  event: CommunityPost;
}

export function EventCard({ event }: EventCardProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const eventDate = event.event_date ? new Date(event.event_date) : null;
  const isEventToday = eventDate ? isToday(eventDate) : false;
  const hostName = event.profile?.full_name;

  const openDetail = () => navigate(routes.community.postDetail(event.scope, event.id));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail();
        }
      }}
      className="flex cursor-pointer items-center gap-4 rounded-legacy-2xl border border-legacy-border bg-legacy-card px-5 py-4 transition-shadow hover:shadow-[0_10px_28px_rgba(20,24,46,0.08)]"
    >
      {eventDate && (
        <div
          className={cn(
            'flex h-16 w-[58px] shrink-0 flex-col items-center justify-center rounded-[14px] bg-legacy-accent',
            isEventToday && 'bg-legacy-primary'
          )}
        >
          <span
            className={cn(
              'text-[11px] font-extrabold uppercase tracking-[0.05em]',
              isEventToday ? 'text-legacy-primary-foreground' : 'text-legacy-primary'
            )}
          >
            {formatDate(eventDate, 'MMM', i18n.language)}
          </span>
          <span
            className={cn(
              'text-[22px] font-extrabold leading-none',
              isEventToday ? 'text-legacy-primary-foreground' : 'text-legacy-primary'
            )}
          >
            {formatDate(eventDate, 'd', i18n.language)}
          </span>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.3]">{event.title}</h3>
        {hostName && (
          <span className="truncate text-[12.5px] text-legacy-muted-foreground">
            {t('community.hostedBy', { name: hostName })}
          </span>
        )}
        {eventDate && (
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-legacy-muted-foreground">
            <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {isEventToday ? t('community.today') : formatDate(eventDate, 'PPP', i18n.language)}
            {' · '}
            {formatDate(eventDate, 'p', i18n.language)}
            {event.event_location && (
              <>
                <MapPin aria-hidden="true" className="ml-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{event.event_location}</span>
              </>
            )}
          </span>
        )}
      </div>

      {event.event_registration_url && (
        <a
          href={safeHref(event.event_registration_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="sm" className="h-9 rounded-legacy-lg px-4 text-[12.5px] font-bold">
            <ExternalLink aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
            {t('community.join')}
          </Button>
        </a>
      )}
    </div>
  );
}
