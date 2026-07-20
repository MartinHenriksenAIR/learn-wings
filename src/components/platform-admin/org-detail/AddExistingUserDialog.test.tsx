import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';
import { getSeatUsage } from '@/lib/seats';

// --- i18n echo; interpolation params are appended so the seat summary is assertable ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts
        ? `${key}:${Object.entries(opts)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')}`
        : key,
  }),
}));

// --- passthrough dialog primitives (jsdom can't drive the Radix portal) ---
vi.mock('@/components/ui/dialog', async () => {
  const ReactActual = await import('react');
  const h = ReactActual.createElement;
  const pass = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  return {
    Dialog: pass,
    DialogContent: pass,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogFooter: pass,
  };
});

// --- passthrough Select (jsdom can't drive Radix Select) ---
vi.mock('@/components/ui/select', async () => {
  const ReactActual = await import('react');
  const h = ReactActual.createElement;
  const pass = ({ children }: { children?: React.ReactNode }) => h('div', null, children);
  return { Select: pass, SelectTrigger: pass, SelectValue: pass, SelectContent: pass, SelectItem: pass };
});

import { AddExistingUserDialog } from './AddExistingUserDialog';

const noop = () => {};
const submit = () => screen.getByRole('button', { name: 'orgDetail.addUser' });

describe('AddExistingUserDialog — seat cap', () => {
  it('shows the seats-used note and keeps submit enabled below the limit', () => {
    const usage = getSeatUsage({ activeMembers: 2, pendingInvites: 1, seatLimit: 10 });
    render(
      <AddExistingUserDialog
        open
        onOpenChange={noop}
        orgName="Acme"
        availableUsers={[]}
        seatUsage={usage}
        onSubmit={noop}
        pending={false}
      />,
    );
    expect(screen.getByText('seats.usage:used=3,limit=10,remaining=7')).toBeInTheDocument();
    expect(screen.queryByText('seats.limitReached')).toBeNull();
  });

  it('shows the unlimited note when the org is unlimited', () => {
    const usage = getSeatUsage({ activeMembers: 50, pendingInvites: 5, seatLimit: null });
    render(
      <AddExistingUserDialog
        open
        onOpenChange={noop}
        orgName="Acme"
        availableUsers={[]}
        seatUsage={usage}
        onSubmit={noop}
        pending={false}
      />,
    );
    expect(screen.getByText('seats.unlimited')).toBeInTheDocument();
  });

  it('disables submit and shows the hint at the seat limit', () => {
    const usage = getSeatUsage({ activeMembers: 8, pendingInvites: 2, seatLimit: 10 });
    render(
      <AddExistingUserDialog
        open
        onOpenChange={noop}
        orgName="Acme"
        availableUsers={[]}
        seatUsage={usage}
        onSubmit={noop}
        pending={false}
      />,
    );
    expect(submit()).toBeDisabled();
    expect(screen.getByText('seats.limitReached')).toBeInTheDocument();
  });

  it('surfaces a server error message inline (the seat-cap 409)', () => {
    const usage = getSeatUsage({ activeMembers: 2, pendingInvites: 0, seatLimit: 10 });
    render(
      <AddExistingUserDialog
        open
        onOpenChange={noop}
        orgName="Acme"
        availableUsers={[]}
        seatUsage={usage}
        errorMessage="Organization is at seat limit"
        onSubmit={noop}
        pending={false}
      />,
    );
    expect(screen.getByText('Organization is at seat limit')).toBeInTheDocument();
  });
});
