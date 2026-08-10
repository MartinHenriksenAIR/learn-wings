import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

// The logo uploader is exercised elsewhere; here it is inert so the form renders.
vi.mock('@/components/ui/file-upload', () => ({ FileUpload: () => null }));
vi.mock('@/hooks/useSignedBrandingUrl', () => ({ useSignedBrandingUrl: () => ({ data: null }) }));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
}));

const mockUseOrgSettings = vi.fn();
vi.mock('@/hooks/useOrgSettings', () => ({
  useOrgSettings: () => mockUseOrgSettings(),
}));

import OrgSettings from './OrgSettings';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';

const defaultPlatformSettings = {
  platformFeatures: {
    certificates_enabled: true,
    quizzes_enabled: true,
    analytics_enabled: true,
    course_reviews_enabled: true,
    community_enabled: true,
  },
  orgFeatures: null,
  isLoading: false,
  refetch: vi.fn().mockResolvedValue(undefined),
};

const baseAuthState = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' },
  currentOrg: null as unknown,
  contextError: null,
  memberships: [],
  isPlatformAdmin: false,
  isOrgAdmin: false,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn().mockResolvedValue(undefined),
  setCurrentOrg: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
};

const org = { id: 'org-1', name: 'Test Org', slug: 'test-org', logo_url: null, seat_limit: 50, created_at: '2026-01-01T00:00:00Z' };

function renderOrgSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrgSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const saveButton = () => screen.getByRole('button', { name: /orgSettings\.saveAll/i });
const switchTo = (tab: string) => fireEvent.click(screen.getByRole('tab', { name: tab }));

describe('OrgSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings });
    mockUseOrgSettings.mockReturnValue({ data: null, isLoading: false });
  });

  // ---- three-way loading guard ----

  it('renders empty state when profile resolved + no currentOrg', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: null });

    renderOrgSettings();

    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
    expect(screen.getByText('orgSettings.noOrgDescription')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('renders spinner when user exists but profile is null (context not yet resolved)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, profile: null, currentOrg: null });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();
  });

  it('renders spinner when usePlatformSettings().isLoading is true', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: true });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders spinner when useOrgSettings().isLoading is true', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    mockUseOrgSettings.mockReturnValue({ data: null, isLoading: true });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  // ---- structure ----

  it('renders three tabs and a disabled Save when nothing has changed', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });

    renderOrgSettings();

    expect(screen.getByRole('tab', { name: 'orgSettings.tabs.profile' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'orgSettings.tabs.access' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'orgSettings.tabs.features' })).toBeInTheDocument();
    // Profile tab is default: the org name input is shown, Save is disabled (pristine).
    expect(screen.getByLabelText('orgSettings.profile.nameLabel')).toHaveValue('Test Org');
    expect(saveButton()).toBeDisabled();
  });

  it('Access tab shows the self-registration switch; Features tab shows 6 switches', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });

    renderOrgSettings();

    switchTo('orgSettings.tabs.access');
    expect(screen.getByRole('switch', { name: 'orgSettings.selfRegLabel' })).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(1);

    switchTo('orgSettings.tabs.features');
    // 5 platform-overridable feature flags + the org-only leaderboard toggle.
    expect(screen.queryAllByRole('switch')).toHaveLength(6);
    expect(screen.getByRole('switch', { name: 'orgSettings.leaderboardLabel' })).toBeInTheDocument();
  });

  // ---- save fans out to only the changed fields ----

  it('renaming the org saves via organization-update only (features untouched)', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    fireEvent.change(screen.getByLabelText('orgSettings.profile.nameLabel'), {
      target: { value: 'Renamed Co' },
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(callApi).toHaveBeenCalledWith('/api/organization-update', {
      orgId: 'org-1',
      updates: { name: 'Renamed Co' },
    });
    expect(callApi).not.toHaveBeenCalledWith('/api/org-settings-update', expect.anything());
  });

  it('toggling self-registration saves via organization-update only', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { ...org, allow_self_registration: true },
    });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    switchTo('orgSettings.tabs.access');
    fireEvent.click(screen.getByRole('switch', { name: 'orgSettings.selfRegLabel' }));

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(callApi).toHaveBeenCalledWith('/api/organization-update', {
      orgId: 'org-1',
      updates: { allow_self_registration: false },
    });
    expect(callApi).not.toHaveBeenCalledWith('/api/org-settings-update', expect.anything());
  });

  it('toggling the leaderboard saves it into features via org-settings-update only', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    switchTo('orgSettings.tabs.features');
    fireEvent.click(screen.getByRole('switch', { name: 'orgSettings.leaderboardLabel' }));

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(callApi).toHaveBeenCalledWith('/api/org-settings-update', {
      orgId: 'org-1',
      features: expect.objectContaining({ leaderboard_enabled: false }),
    });
    expect(callApi).not.toHaveBeenCalledWith('/api/organization-update', expect.anything());
  });

  it('merges onto raw features so an unmanaged key is preserved on save', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    // exercises_enabled is not surfaced as a toggle — it must survive the upsert.
    mockUseOrgSettings.mockReturnValue({ data: { exercises_enabled: true }, isLoading: false });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    switchTo('orgSettings.tabs.features');
    fireEvent.click(screen.getByRole('switch', { name: 'orgSettings.leaderboardLabel' }));

    await act(async () => {
      fireEvent.click(saveButton());
    });

    const call = vi.mocked(callApi).mock.calls.find(([url]) => url === '/api/org-settings-update');
    expect(call).toBeTruthy();
    expect((call![1] as { features: Record<string, boolean> }).features).toMatchObject({
      exercises_enabled: true,
      leaderboard_enabled: false,
    });
  });

  it('morphs the save button to "Saved" on success with no success toast', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    fireEvent.change(screen.getByLabelText('orgSettings.profile.nameLabel'), {
      target: { value: 'Renamed Co' },
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /common\.saved/i })).toBeInTheDocument();
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('disables Save when the name is invalid (too short)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: org });

    renderOrgSettings();
    fireEvent.change(screen.getByLabelText('orgSettings.profile.nameLabel'), {
      target: { value: 'a' },
    });

    expect(screen.getByText('orgSettings.profile.nameError')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});
