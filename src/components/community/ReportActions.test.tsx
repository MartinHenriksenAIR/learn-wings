import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReportActions, type ReportActionsReport } from './ReportActions';

// t echoes keys so assertions pin i18n keys, not translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const basePost: ReportActionsReport = {
  id: 'r1',
  target_type: 'post',
  target_id: 't1',
  status: 'pending',
  post_id: null,
  target_is_hidden: false,
  target_is_locked: false,
};

function setup(overrides: Partial<ReportActionsReport> = {}) {
  const h = {
    onViewContent: vi.fn(),
    onSetHidden: vi.fn(),
    onSetLocked: vi.fn(),
    onDismiss: vi.fn(),
    onReview: vi.fn(),
  };
  render(
    <TooltipProvider>
      <ReportActions
        report={{ ...basePost, ...overrides }}
        {...h}
        visibilityPending={false}
        lockPending={false}
        updatePending={false}
      />
    </TooltipProvider>,
  );
  return h;
}

describe('ReportActions', () => {
  it('shows Hide when a post is visible and hides on click', () => {
    const { onSetHidden } = setup({ target_is_hidden: false });
    expect(screen.queryByRole('button', { name: 'moderation.showPost' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'moderation.hidePost' }));
    expect(onSetHidden).toHaveBeenCalledWith(true);
  });

  it('shows Unhide (showPost key) when a post is hidden and unhides on click', () => {
    const { onSetHidden } = setup({ target_is_hidden: true });
    fireEvent.click(screen.getByRole('button', { name: 'moderation.showPost' }));
    expect(onSetHidden).toHaveBeenCalledWith(false);
  });

  it('toggles lock state for posts', () => {
    const { onSetLocked } = setup({ target_is_locked: false });
    fireEvent.click(screen.getByRole('button', { name: 'moderation.lockPost' }));
    expect(onSetLocked).toHaveBeenCalledWith(true);
  });

  it('renders no lock toggle for comment targets, and a comment hide label', () => {
    setup({ target_type: 'comment', post_id: 'p9', target_is_locked: null });
    expect(screen.queryByRole('button', { name: 'moderation.lockPost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moderation.unlockPost' })).toBeNull();
    expect(screen.getByRole('button', { name: 'moderation.hideComment' })).toBeInTheDocument();
  });

  it('disables toggles when the target was deleted (state null)', () => {
    setup({ target_is_hidden: null, target_is_locked: null });
    expect(screen.getByRole('button', { name: 'moderation.hidePost' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'moderation.lockPost' })).toBeDisabled();
  });

  it('hides dismiss/review actions when the report is not pending', () => {
    setup({ status: 'reviewed' });
    expect(screen.queryByRole('button', { name: 'moderation.dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moderation.markReviewed' })).toBeNull();
  });
});
