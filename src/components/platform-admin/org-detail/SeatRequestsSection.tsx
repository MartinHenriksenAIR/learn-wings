import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { SeatRequest } from '@/lib/types';

interface SeatRequestsSectionProps {
  requests: SeatRequest[];
  onFulfil: (id: string) => void;
  fulfilingId: string | null;
}

/**
 * Platform-admin fulfilment: lists an org's PENDING seat requests with a
 * "Mark fulfilled" action that bumps the org's seat_limit. Renders nothing
 * when there is nothing pending.
 */
export function SeatRequestsSection({ requests, onFulfil, fulfilingId }: SeatRequestsSectionProps) {
  const { t } = useTranslation();
  const pending = requests.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4">
      <h2 className="mb-3 text-[13px] font-bold text-[#4a4f60]">{t('seatRequests.sectionTitle')}</h2>
      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{r.requester_name ?? r.requester_email ?? '—'}</strong>
              {' · '}
              <span>{r.additional_seats}</span>{' '}{t('seatRequests.colSeats').toLowerCase()}
              {' · '}
              {r.additional_seats * r.unit_price_snapshot} {r.currency}/yr
            </span>
            <Button size="sm" onClick={() => onFulfil(r.id)} disabled={fulfilingId === r.id}>
              {t('seatRequests.fulfil')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
