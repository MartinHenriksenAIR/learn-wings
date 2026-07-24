import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReportCard } from './ReportCard';
import type { ReportWithDetails } from '@/hooks/useReportModeration';

// t echoes keys so assertions pin i18n keys, not translated copy; language is
// needed for the relative-time formatter in the reporter line.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const baseReport: ReportWithDetails = {
  id: 'r1',
  reporter_user_id: 'u1',
  target_type: 'post',
  target_id: 't1',
  org_id: null,
  reason: 'Spam content',
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  admin_notes: null,
  created_at: new Date().toISOString(),
  post_id: null,
  target_is_hidden: false,
  target_is_locked: false,
  reporter: { id: 'u1', full_name: 'Alice' },
};

function setup(props: { report?: Partial<ReportWithDetails>; scopeBadge?: React.ReactNode } = {}) {
  const handlers = {
    onViewContent: vi.fn(),
    onSetHidden: vi.fn(),
    onSetLocked: vi.fn(),
    onDismiss: vi.fn(),
    onReview: vi.fn(),
  };
  render(
    <TooltipProvider>
      <ReportCard
        report={{ ...baseReport, ...props.report }}
        scopeBadge={props.scopeBadge}
        {...handlers}
        visibilityPending={false}
        lockPending={false}
        updatePending={false}
      />
    </TooltipProvider>,
  );
  return handlers;
}

describe('ReportCard', () => {
  it('renders the report reason and the shared action bar (no scope badge by default)', () => {
    setup();
    expect(screen.getByText('Spam content')).toBeInTheDocument();
    // First button of the embedded ReportActions bar is View content (#160).
    expect(screen.getByRole('button', { name: 'moderation.viewContent' })).toBeInTheDocument();
    // Org queue passes no badge → the platform-only scope label is absent.
    expect(screen.queryByText('scope-badge')).not.toBeInTheDocument();
  });

  it('renders a provided scope badge in the meta row (platform queue)', () => {
    setup({ scopeBadge: <span>scope-badge</span> });
    expect(screen.getByText('scope-badge')).toBeInTheDocument();
    expect(screen.getByText('Spam content')).toBeInTheDocument();
  });

  it('shows the inline admin note when present', () => {
    setup({ report: { admin_notes: 'Handled by mod' } });
    expect(screen.getByText('Handled by mod')).toBeInTheDocument();
    expect(screen.getByText('moderation.adminNotesInline')).toBeInTheDocument();
  });
});
