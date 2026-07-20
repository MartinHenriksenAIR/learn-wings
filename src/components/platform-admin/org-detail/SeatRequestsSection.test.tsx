import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// i18n echo — REPO CONVENTION: t returns the key. Assert on keys + real data.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
}));

import { SeatRequestsSection } from './SeatRequestsSection';
import type { SeatRequest } from '@/lib/types';

const pending: SeatRequest = {
  id: 'req-1', org_id: 'org-1', requested_by_user_id: 'p1', additional_seats: 5,
  unit_price_snapshot: 1200, currency: 'DKK', status: 'pending',
  created_at: '2026-07-20T10:00:00.000Z', fulfilled_at: null, cancelled_at: null,
  requester_name: 'Mette', requester_email: 'mette@acme.dk',
};

describe('SeatRequestsSection', () => {
  it('renders a pending request row with a fulfil action', () => {
    const onFulfil = vi.fn();
    render(<SeatRequestsSection requests={[pending]} onFulfil={onFulfil} fulfilingId={null} />);
    expect(screen.getByText('Mette')).toBeInTheDocument(); // exact: the <strong> requester name
    screen.getByRole('button', { name: 'seatRequests.fulfil' }).click();
    expect(onFulfil).toHaveBeenCalledWith('req-1');
  });

  it('renders nothing when there are no pending requests', () => {
    const { container } = render(<SeatRequestsSection requests={[]} onFulfil={vi.fn()} fulfilingId={null} />);
    expect(container.firstChild).toBeNull();
  });
});
