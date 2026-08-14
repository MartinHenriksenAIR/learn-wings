import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')}` : key,
  }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values?: Record<string, unknown> }) =>
    React.createElement('span', null, values ? `${i18nKey}:name=${values.name}` : i18nKey),
}));

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

vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

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

    expect(screen.queryByRole('button', { name: 'platformAdmins.confirm' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'platformAdmins.revoke' })[0]);
    expect(onRevoke).not.toHaveBeenCalled();

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

    fireEvent.click(screen.getByRole('button', { name: 'Cy Candidate' }));
    fireEvent.click(screen.getByRole('button', { name: 'platformAdmins.grant' }));
    expect(onGrant).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'platformAdmins.confirm' }));
    expect(onGrant).toHaveBeenCalledWith('p3');
  });

  it('associates the grant label with its select control (#327)', () => {
    render(
      <PlatformAdminsSection
        admins={admins}
        availableUsers={candidates}
        onGrant={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );
    expect(screen.getByLabelText('platformAdmins.grantLabel')).toHaveAttribute('id', 'grant-admin-user');
  });
});
