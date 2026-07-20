import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { routes } from '@/lib/routes';

// OrgAnalytics is one component serving two routes; it decides which by
// matching location.pathname against routes.platformAdmin.analytics. This test
// pins that branch so a future route rename can't silently flip the platform
// "Global Analytics" page into the org-scoped view (review #174, findings #1/#2).

// `t` echoes the key so assertions pin i18n keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// AppLayout passthrough so the page's own <h1>{pageTitle}</h1> is observable.
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

// SlidingTabs: render each tab label as text so we can assert which tabs exist.
vi.mock('@/components/ui/sliding-tabs', () => ({
  SlidingTabs: ({ tabs }: { tabs: { key: string; label: React.ReactNode }[] }) =>
    React.createElement(
      'div',
      null,
      tabs.map((tab) => React.createElement('span', { key: tab.key }, tab.label)),
    ),
}));

// Keep the tab-content and storage-backed children out of this focused test.
vi.mock('@/components/org-admin/analytics/AnalyticsOverview', () => ({ AnalyticsOverview: () => null }));
vi.mock('@/components/org-admin/analytics/TeamPerformanceTab', () => ({ TeamPerformanceTab: () => null }));
vi.mock('@/components/org-admin/analytics/CourseProgressTab', () => ({ CourseProgressTab: () => null }));
vi.mock('@/components/org-admin/OrgMembersTab', () => ({ OrgMembersTab: () => null }));
vi.mock('@/components/ui/file-upload', () => ({ FileUpload: () => null }));
vi.mock('@/lib/api-client', () => ({ callApi: vi.fn(), callApiRaw: vi.fn() }));

// Data hooks: mocked so no network fires; return values set per test.
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
    // Members tab is org-only — absent in the global view.
    expect(screen.queryByText('analytics.tabs.members')).not.toBeInTheDocument();
  });

  it('renders the org-scoped view at the org admin route', () => {
    primeHooks({ isPlatformAdmin: false, currentOrg: org });
    renderAt(routes.orgAdmin.root);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nav.organization');
    // Members tab is present in the org view.
    expect(screen.getByText('analytics.tabs.members')).toBeInTheDocument();
  });
});
