import { useTranslation } from 'react-i18next';
import { Calendar, ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/date-locale';
import { SectionHeading, SeeMore } from './section';
import type { CommunityPost } from '@/lib/community-types';

interface DashboardEventsProps {
  events: CommunityPost[];
  onEventClick: (event: CommunityPost) => void;
  onSeeMore: () => void;
}

export function DashboardEvents({ events, onEventClick, onSeeMore }: DashboardEventsProps) {
  const { t, i18n } = useTranslation();

  return (
    <section className="mt-[30px] first:mt-0" data-testid="dashboard-events">
      <SectionHeading>{t('dashboard.events.title')}</SectionHeading>

      {events.length === 0 ? (
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title={t('dashboard.events.emptyTitle')}
          description={t('dashboard.events.emptyDescription')}
          className="border-0 bg-transparent p-8"
        />
      ) : (
        events.map((event) => {
          const date = new Date(event.event_date!);
          return (
            <div
              key={event.id}
              role="button"
              tabIndex={0}
              onClick={() => onEventClick(event)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEventClick(event);
                }
              }}
              className="flex cursor-pointer items-center gap-[13px] py-[11px] [&+&]:border-t [&+&]:border-[rgba(23,26,38,0.07)]"
            >
              <span className="w-[46px] shrink-0 rounded-[14px] bg-legacy-dash-a1 px-0 py-[7px] pb-2 text-center text-legacy-dash-ink">
                <b className="block text-[17px] font-extrabold leading-none tabular-nums">
                  {formatDate(date, 'd', i18n.language)}
                </b>
                <span className="mt-[3px] block text-[9.5px] font-extrabold uppercase tracking-[0.08em] opacity-75">
                  {formatDate(date, 'MMM', i18n.language)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-[3px] line-clamp-2 block text-[13.5px] font-bold leading-[1.25] tracking-[-0.01em]">
                  {event.title}
                </span>
                <span className="block truncate text-[11.5px] font-medium text-legacy-muted-foreground">
                  {event.event_location ? `${event.event_location} · ` : ''}
                  {formatDate(date, 'HH:mm', i18n.language)}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-legacy-muted-foreground" />
            </div>
          );
        })
      )}

      <SeeMore onClick={onSeeMore} />
    </section>
  );
}
