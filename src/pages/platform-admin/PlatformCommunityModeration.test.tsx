import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock community-api ---
vi.mock('@/lib/community-api', () => ({
  fetchReports: vi.fn(),
  updateReport: vi.fn(),
  togglePostHidden: vi.fn(),
  toggleCommentHidden: vi.fn(),
  togglePostLocked: vi.fn(),
}));

// --- mock api-client ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

// --- mock sonner ---
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchReports } from '@/lib/community-api';
import { callApi } from '@/lib/api-client';
import PlatformCommunityModeration from './PlatformCommunityModeration';

const mockFetchReports = fetchReports as ReturnType<typeof vi.fn>;
const mockCallApi = callApi as ReturnType<typeof vi.fn>;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <MemoryRouter>
          <PlatformCommunityModeration />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const globalReport = {
  id: 'report-1',
  reporter_user_id: 'user-1',
  target_type: 'post' as const,
  target_id: 'post-global-1',
  org_id: null,
  reason: 'Spam content',
  status: 'pending' as const,
  reviewed_by: null,
  reviewed_at: null,
  admin_notes: null,
  created_at: new Date().toISOString(),
  reporter: { id: 'user-1', full_name: 'Alice' },
};

const orgReport = {
  id: 'report-2',
  reporter_user_id: 'user-2',
  target_type: 'post' as const,
  target_id: 'post-org-1',
  org_id: 'org-1',
  reason: 'Offensive content',
  status: 'pending' as const,
  reviewed_by: null,
  reviewed_at: null,
  admin_notes: null,
  created_at: new Date().toISOString(),
  reporter: { id: 'user-2', full_name: 'Bob' },
};

const mockOrgs = [
  { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp', logo_url: null, seat_limit: null, created_at: new Date().toISOString() },
];

describe('PlatformCommunityModeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return both reports
    mockFetchReports.mockResolvedValue([globalReport, orgReport]);
    // Default: return mock orgs
    mockCallApi.mockResolvedValue({ organizations: mockOrgs });
  });

  it('calls fetchReports without a scope filter (all-scope regression guard)', async () => {
    renderPage();

    await waitFor(() => {
      expect(mockFetchReports).toHaveBeenCalledWith(undefined, { status: 'pending' });
    });

    // Must NOT have been called with scope: 'global'
    expect(mockFetchReports).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'global' })
    );
  });

  it('renders both global and org-scoped reports with correct scope badges', async () => {
    renderPage();

    // Both reports should be visible
    await waitFor(() => {
      expect(screen.getByText('Spam content')).toBeInTheDocument();
    });

    expect(screen.getByText('Offensive content')).toBeInTheDocument();

    // Global report shows the Global badge i18n key
    expect(screen.getByText('platformModeration.scopeGlobal')).toBeInTheDocument();

    // Org report shows the org name from the organizations response
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('view-content button for org report opens /app/community/org/posts/<target_id>', async () => {
    // Render with only the org-scoped report so no global card is present
    mockFetchReports.mockResolvedValue([orgReport]);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Offensive content')).toBeInTheDocument();
    });

    // Only one report rendered — the first button in the document is the View content button
    const firstButton = screen.getAllByRole('button')[0];
    firstButton.click();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      `/app/community/org/posts/post-org-1`,
      '_blank',
      'noopener,noreferrer'
    );

    openSpy.mockRestore();
  });

  it('view-content button for global report opens /app/community/global/posts/<target_id>', async () => {
    // Render with only the global report so no org card is present
    mockFetchReports.mockResolvedValue([globalReport]);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Spam content')).toBeInTheDocument();
    });

    // Only one report rendered — the first button in the document is the View content button
    const firstButton = screen.getAllByRole('button')[0];
    firstButton.click();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      `/app/community/global/posts/post-global-1`,
      '_blank',
      'noopener,noreferrer'
    );

    openSpy.mockRestore();
  });
});
