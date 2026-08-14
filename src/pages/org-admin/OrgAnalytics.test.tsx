import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { routes } from '@/lib/routes';
import en from '@/i18n/locales/en.json';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('@/components/ui/sliding-tabs', () => ({
  SlidingTabs: ({ tabs }: { tabs: { key: string; label: React.ReactNode }[] }) =>
    React.createElement(
      'div',
      null,
      tabs.map((tab) => React.createElement('span', { key: tab.key }, tab.label)),
    ),
}));

vi.mock('@/components/org-admin/analytics/AnalyticsOverview', () => ({ AnalyticsOverview: () => null }));
vi.mock('@/components/org-admin/analytics/TeamPerformanceTab', () => ({ TeamPerformanceTab: () => null }));
vi.mock('@/components/org-admin/analytics/CourseProgressTab', () => ({ CourseProgressTab: () => null }));
vi.mock('@/components/org-admin/OrgMembersTab', () => ({ OrgMembersTab: () => null }));
vi.mock('@/components/ui/file-upload', () => ({ FileUpload: () => null }));
vi.mock('@/lib/api-client', () => ({ callApi: vi.fn(), callApiRaw: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/usePlatformSettings', () => ({ usePlatformSettings: vi.fn() }));
vi.mock('@/hooks/useOrganizations', () => ({ useOrganizations: vi.fn() }));
vi.mock('@/hooks/useOrgAnalyticsData', () => ({ useOrgAnalyticsData: vi.fn() }));

import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useOrgAnalyticsData } from '@/hooks/useOrgAnalyticsData';
import OrgAnalytics from './OrgAnalytics';

const org = { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp', logo_url: null };

function primeHooks({ isPlatformAdmin, currentOrg }: { isPlatformAdmin: boolean; currentOrg: typeof org | null }) {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg,
    isPlatformAdmin,
    refreshUserContext: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(usePlatformSettings).mockReturnValue({
    features: { analytics_enabled: true },
    isLoading: false,
  } as unknown as ReturnType<typeof usePlatformSettings>);
  vi.mocked(useOrganizations).mockReturnValue({ data: [], error: null } as unknown as ReturnType<typeof useOrganizations>);
  vi.mocked(useOrgAnalyticsData).mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useOrgAnalyticsData>);
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routes.orgAdmin.root} element={<OrgAnalytics />} />
          <Route path={routes.platformAdmin.analytics} element={<OrgAnalytics />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrgAnalytics — view is selected by route (#120)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the platform-wide global view at the platform analytics route', () => {
    primeHooks({ isPlatformAdmin: true, currentOrg: null });
    renderAt(routes.platformAdmin.analytics);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nav.globalAnalytics');
    expect(screen.queryByText('analytics.tabs.members')).not.toBeInTheDocument();
  });

  it('renders the org-scoped view at the org admin route', () => {
    primeHooks({ isPlatformAdmin: false, currentOrg: org });
    renderAt(routes.orgAdmin.root);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nav.organization');
    expect(screen.getByText('analytics.tabs.members')).toBeInTheDocument();
  });
});

describe('OrgAnalytics — failed fetch shows error fork, not all-zero stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the retryable error state (not the stats tabs) when the analytics fetch fails', () => {
    primeHooks({ isPlatformAdmin: false, currentOrg: org });
    const refetch = vi.fn();
    vi.mocked(useOrgAnalyticsData).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useOrgAnalyticsData>);

    renderAt(routes.orgAdmin.root);

    expect(screen.getByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(en.common.retry.length).toBeGreaterThan(0);
    const retryButton = screen.getByRole('button', { name: 'common.retry' });
    expect(retryButton).toBeInTheDocument();
    expect(screen.queryByText('analytics.tabs.overview')).not.toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
