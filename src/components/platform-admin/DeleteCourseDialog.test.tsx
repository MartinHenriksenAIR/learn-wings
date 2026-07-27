import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// --- i18n echo; interpolation params are appended so the title is assertable ---
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

// --- passthrough alert-dialog primitives (jsdom can't drive the Radix portal).
// AlertDialog honours `open` so the closed case stays testable. ---
vi.mock('@/components/ui/alert-dialog', () => {
  const pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const btn = ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => React.createElement('button', { onClick, disabled }, children);
  return {
    AlertDialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? React.createElement('div', null, children) : null,
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogFooter: pass,
    AlertDialogAction: btn,
    AlertDialogCancel: btn,
  };
});

import { DeleteCourseDialog } from './DeleteCourseDialog';

const noop = () => {};

const setup = (props: Partial<React.ComponentProps<typeof DeleteCourseDialog>> = {}) =>
  render(
    <DeleteCourseDialog
      open
      onOpenChange={noop}
      courseTitle="Wing Basics"
      onConfirm={noop}
      pending={false}
      {...props}
    />,
  );

const confirmButton = () => screen.getByRole('button', { name: 'courseDelete.confirm' });
const cancelButton = () => screen.getByRole('button', { name: 'common.cancel' });

describe('DeleteCourseDialog', () => {
  it('renders the shared courseDelete namespace, not a per-page one', () => {
    setup();
    expect(screen.getByText('courseDelete.title')).toBeInTheDocument();
    expect(screen.getByText('courseDelete.itemModules')).toBeInTheDocument();
    expect(screen.getByText('courseDelete.itemEnrollments')).toBeInTheDocument();
    expect(screen.getByText('courseDelete.itemQuizzes')).toBeInTheDocument();
    expect(screen.getByText('courseDelete.irreversible')).toBeInTheDocument();
    expect(confirmButton()).toBeInTheDocument();
  });

  it('interpolates the course title into the intro line', () => {
    setup({ courseTitle: 'Wing Basics' });
    expect(screen.getByText('courseDelete.intro:title=Wing Basics')).toBeInTheDocument();
  });

  it('still renders when no course is selected yet (list-driven call site)', () => {
    setup({ courseTitle: undefined });
    expect(screen.getByText('courseDelete.intro:title=undefined')).toBeInTheDocument();
  });

  it('fires onConfirm from the destructive action', () => {
    const onConfirm = vi.fn();
    setup({ onConfirm });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables both footer buttons and shows a spinner while pending', () => {
    const { container } = setup({ pending: true });
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows no spinner and leaves the buttons enabled when idle', () => {
    const { container } = setup({ pending: false });
    expect(confirmButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByText('courseDelete.title')).not.toBeInTheDocument();
  });
});
