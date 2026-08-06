import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
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
  refetch: vi.fn(),
};

const baseAuthState = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' },
  currentOrg: null,
  memberships: [],
  isPlatformAdmin: false,
  isOrgAdmin: false,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn(),
  setCurrentOrg: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
};

function renderOrgSettings() {
  return render(
    <MemoryRouter>
      <OrgSettings />
    </MemoryRouter>
  );
}

describe('OrgSettings — three-way loading guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when profile resolved + no currentOrg + settings not loading', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: null });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });

    renderOrgSettings();

    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
    expect(screen.getByText('orgSettings.noOrgDescription')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('renders spinner when user exists but profile is null (context not yet resolved)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, profile: null, currentOrg: null });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();
    expect(screen.queryByText('orgSettings.noOrgDescription')).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders spinner when usePlatformSettings().isLoading is true', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: true });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders form when currentOrg is set and context is resolved', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Test Org' },
    });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });

    renderOrgSettings();

    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();

    const switches = screen.queryAllByRole('switch');
    expect(switches).toHaveLength(6); // 5 feature overrides + self-registration (#356)
    expect(
      screen.getByRole('button', { name: /orgSettings\.saveButton/i })
    ).toBeInTheDocument();
  });

  it('keeps the form mounted during the post-save refetch (isLoading flips true while saving)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Test Org' },
    });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });

    let resolveSave: (v: unknown) => void = () => {};
    vi.mocked(callApi).mockReturnValue(new Promise((res) => { resolveSave = res; }));

    const { rerender } = renderOrgSettings();
    fireEvent.click(screen.getByRole('button', { name: /orgSettings\.saveButton/i }));

    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: true });
    rerender(
      <MemoryRouter>
        <OrgSettings />
      </MemoryRouter>
    );

    expect(screen.queryAllByRole('switch')).toHaveLength(6);
    expect(screen.getByRole('button', { name: /orgSettings\.saveButton/i })).toBeInTheDocument();

    await act(async () => {
      resolveSave({});
    });
  });

  it('morphs the save button to the "Saved" state on a successful save (no success toast)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Test Org' },
    });
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUsePlatformSettings.mockReturnValue({
      ...defaultPlatformSettings,
      isLoading: false,
      refetch,
    });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /orgSettings\.saveButton/i }));
    });

    expect(callApi).toHaveBeenCalledWith('/api/org-settings-update', {
      orgId: 'org-1',
      features: expect.any(Object),
    });
    expect(refetch).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /common\.saved/i })).toBeInTheDocument();
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('#356: toggling self-registration off persists it via organization-update on save', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Test Org', allow_self_registration: true },
    });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    fireEvent.click(screen.getByRole('switch', { name: 'orgSettings.selfRegLabel' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /orgSettings\.saveButton/i }));
    });

    expect(callApi).toHaveBeenCalledWith('/api/organization-update', {
      orgId: 'org-1',
      updates: { allow_self_registration: false },
    });
  });

  it('#356: does NOT call organization-update when self-registration is unchanged', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Test Org', allow_self_registration: true },
    });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });
    vi.mocked(callApi).mockResolvedValue({} as never);

    renderOrgSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /orgSettings\.saveButton/i }));
    });

    expect(callApi).toHaveBeenCalledWith('/api/org-settings-update', expect.anything());
    expect(callApi).not.toHaveBeenCalledWith('/api/organization-update', expect.anything());
  });
});
