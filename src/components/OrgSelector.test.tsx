import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { SidebarProvider } from '@/components/ui/sidebar';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ callApi: mockCallApi }));

const mockSetCurrentOrg = vi.fn();
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { OrgSelector } from './OrgSelector';

const orgA = {
  id: 'org-a',
  name: 'Alpha Org',
  slug: 'alpha',
  logo_url: null,
  seat_limit: 10,
  created_at: '2026-01-01T00:00:00Z',
};
const orgB = { ...orgA, id: 'org-b', name: 'Beta Org', slug: 'beta' };

const baseAuth = {
  user: { id: 'u-1', tid: 't-1', email: 'admin@x.test', name: 'Admin' },
  profile: { id: 'p-1', is_platform_admin: true },
  memberships: [],
  currentOrg: null,
  isPlatformAdmin: true,
  isOrgAdmin: false,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn(),
  setCurrentOrg: mockSetCurrentOrg,
  viewMode: 'org_admin' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: true,
};

// useOrganizations needs a QueryClient; fresh per render so no cache leaks between tests.
// OrgSelector reads useSidebar() (for the collapsed icon-rail rendering, #370), so it must
// be wrapped in a SidebarProvider — `open` drives expanded vs collapsed.
function renderSelector({ open = true }: { open?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen={open}>
        <OrgSelector />
      </SidebarProvider>
    </QueryClientProvider>
  );
}

describe('OrgSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches orgs from the Azure /api/organizations endpoint for platform admins', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue(baseAuth);

    renderSelector();

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/organizations', {});
    });
  });

  it('auto-selects the first returned org when no org is currently selected', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue(baseAuth);

    renderSelector();

    await waitFor(() => {
      expect(mockSetCurrentOrg).toHaveBeenCalledWith(orgA);
    });
  });

  it('does NOT auto-select when an org is already selected', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue({ ...baseAuth, currentOrg: orgB });

    renderSelector();

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalled();
    });
    expect(mockSetCurrentOrg).not.toHaveBeenCalled();
  });

  it('does NOT fetch orgs when the user is not a platform admin', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      isPlatformAdmin: false,
      profile: { id: 'p-1', is_platform_admin: false },
      viewMode: 'learner' as const,
    });

    renderSelector();

    // Let any pending microtasks settle, then assert no fetch + no spinner.
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('clears the loading spinner after the fetch resolves', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA] });
    mockUseAuth.mockReturnValue(baseAuth);

    renderSelector();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });

  it('collapses to an icon-only trigger labelled with the current org (#370)', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue({ ...baseAuth, currentOrg: orgB });

    renderSelector({ open: false });

    // In the rail the switcher is a square button whose accessible name carries the
    // org (the tooltip mirror), and the org name is NOT rendered as visible trigger text.
    await waitFor(() => {
      expect(document.querySelector('button[aria-label="Beta Org"]')).not.toBeNull();
    });
    expect(screen.queryByText('Beta Org')).not.toBeInTheDocument();
  });

  it('renders the full-width trigger (no icon-only aria-label) when expanded (#370)', async () => {
    mockCallApi.mockResolvedValue({ organizations: [orgA, orgB] });
    mockUseAuth.mockReturnValue({ ...baseAuth, currentOrg: orgB });

    renderSelector({ open: true });

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalled();
    });
    expect(document.querySelector('button[aria-label="Beta Org"]')).toBeNull();
  });
});
