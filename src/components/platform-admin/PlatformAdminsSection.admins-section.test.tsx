import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// --- i18n echo: t/Trans return the key. Interpolation params are appended so
// they stay assertable. REPO CONVENTION (see SeatRequestsSection.test). ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values?: Record<string, unknown> }) =>
    React.createElement('span', null, values ? `${i18nKey}:name=${values.name}` : i18nKey),
}));

// --- passthrough AlertDialog; Action/Cancel stay real buttons so onClick fires
// (jsdom can't drive the Radix portal). The section gates the dialog body on
// its own `confirm` state, so the passthrough still proves the two-step flow. ---
vi.mock('@/components/ui/alert-dialog', () => {
  const pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const btn = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children);
  return {
    AlertDialog: pass,
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogFooter: pass,
    AlertDialogAction: btn,
    AlertDialogCancel: btn,
  };
});

// --- passthrough Select: each item is a button that sets the selection via the
// parent's onValueChange (jsdom can't drive Radix Select). ---
vi.mock('@/components/ui/select', () => {
  const Ctx = React.createContext<((v: string) => void) | undefined>(undefined);
  const Select = ({ children, onValueChange }: { children?: React.ReactNode; onValueChange?: (v: string) => void }) =>
    React.createElement(Ctx.Provider, { value: onValueChange }, React.createElement('div', null, children));
  const SelectItem = ({ children, value }: { children?: React.ReactNode; value: string }) => {
    const onValueChange = React.useContext(Ctx);
    return React.createElement('button', { onClick: () => onValueChange?.(value) }, children);
  };
  const pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return { Select, SelectItem, SelectTrigger: pass, SelectValue: pass, SelectContent: pass };
});

import { PlatformAdminsSection, type PlatformAdmin } from './PlatformAdminsSection';

const admins: PlatformAdmin[] = [
  { id: 'p1', full_name: 'Ada Admin', email: 'ada@contoso.com' },
  { id: 'p2', full_name: 'Bo Boss', email: 'bo@contoso.com' },
];
const candidates = [{ id: 'p3', full_name: 'Cy Candidate' }];

describe('PlatformAdminsSection (admins-section)', () => {
  it('lists the current platform admins', () => {
    render(
      <PlatformAdminsSection
        admins={admins}
        availableUsers={candidates}
        onGrant={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Bo Boss')).toBeInTheDocument();
  });

  it('gates revoke behind the confirm dialog — onRevoke only fires after confirming', () => {
    const onRevoke = vi.fn();
    render(
      <PlatformAdminsSection
        admins={admins}
        availableUsers={candidates}
        onGrant={vi.fn()}
        onRevoke={onRevoke}
        pending={false}
      />,
    );

    // No confirm action yet — the dialog body is gated on internal state.
    expect(screen.queryByRole('button', { name: 'platformAdmins.confirm' })).toBeNull();

    // Click a row's Revoke: opens the confirm, does NOT call onRevoke.
    fireEvent.click(screen.getAllByRole('button', { name: 'platformAdmins.revoke' })[0]);
    expect(onRevoke).not.toHaveBeenCalled();

    // Confirming fires the mutation with the right id.
    fireEvent.click(screen.getByRole('button', { name: 'platformAdmins.confirm' }));
    expect(onRevoke).toHaveBeenCalledWith('p1');
  });

  it('gates grant behind the confirm dialog — onGrant only fires after confirming', () => {
    const onGrant = vi.fn();
    render(
      <PlatformAdminsSection
        admins={admins}
        availableUsers={candidates}
        onGrant={onGrant}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );

    // Select the candidate, then click Grant → opens confirm without granting.
    fireEvent.click(screen.getByRole('button', { name: 'Cy Candidate' }));
    fireEvent.click(screen.getByRole('button', { name: 'platformAdmins.grant' }));
    expect(onGrant).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'platformAdmins.confirm' }));
    expect(onGrant).toHaveBeenCalledWith('p3');
  });
});
