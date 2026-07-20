import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n echo — REPO CONVENTION (see AddExistingUserDialog.test.tsx): t returns
// the key, with interpolation params appended. Component tests assert on keys,
// NOT on English/Danish text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
}));

// Passthrough dialog primitives (jsdom can't drive the Radix portal).
vi.mock('@/components/ui/dialog', async () => {
  const R = await import('react');
  const pass = ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children);
  return { Dialog: pass, DialogContent: pass, DialogHeader: pass, DialogTitle: pass, DialogDescription: pass, DialogFooter: pass };
});

vi.mock('@/lib/api-client', () => ({ callApi: vi.fn(), ApiError: class extends Error {} }));
const mockUseSeatPricing = vi.fn();
vi.mock('@/hooks/useSeatPricing', () => ({ useSeatPricing: () => mockUseSeatPricing() }));

import { RequestSeatsDialog } from './RequestSeatsDialog';

const renderDialog = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <RequestSeatsDialog orgId="org-1" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
};

describe('RequestSeatsDialog', () => {
  it('gates to the contact message + disables submit when no price is configured', () => {
    mockUseSeatPricing.mockReturnValue({ data: { annual_price_per_seat: null, currency: 'DKK' }, isLoading: false });
    renderDialog();
    expect(screen.getByText('seatRequests.notConfigured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'seatRequests.submit' })).toBeDisabled();
  });

  it('shows the ex-VAT estimate echo when a price is configured (1 seat × 1200)', () => {
    mockUseSeatPricing.mockReturnValue({ data: { annual_price_per_seat: 1200, currency: 'DKK' }, isLoading: false });
    renderDialog();
    expect(screen.getByText('seatRequests.estimate:seats=1,price=1200,currency=DKK,total=1200')).toBeInTheDocument();
    expect(screen.getByText('seatRequests.vatNote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'seatRequests.submit' })).not.toBeDisabled();
  });
});
