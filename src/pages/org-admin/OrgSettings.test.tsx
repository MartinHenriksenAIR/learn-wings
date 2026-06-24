import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

// --- mock sonner toast ---
vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

// --- useAuth mock factory ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// --- usePlatformSettings mock factory ---
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

    // Empty state text keys must be visible
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
    expect(screen.getByText('orgSettings.noOrgDescription')).toBeInTheDocument();

    // No editable controls
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    // No spinner
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('renders spinner when user exists but profile is null (context not yet resolved)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, profile: null, currentOrg: null });
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: false });

    renderOrgSettings();

    // Spinner must be present
    expect(document.querySelector('.animate-spin')).not.toBeNull();

    // No empty state
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();
    expect(screen.queryByText('orgSettings.noOrgDescription')).toBeNull();

    // No form
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

    // No spinner
    expect(document.querySelector('.animate-spin')).toBeNull();

    // No empty state
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();

    // Five feature switches present
    const switches = screen.queryAllByRole('switch');
    expect(switches).toHaveLength(5);

    // Save button present (idle label key under the i18n passthrough mock)
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

    // Save call hangs so the component stays in saving=true
    let resolveSave: (v: unknown) => void = () => {};
    vi.mocked(callApi).mockReturnValue(new Promise((res) => { resolveSave = res; }));

    const { rerender } = renderOrgSettings();
    fireEvent.click(screen.getByRole('button', { name: /orgSettings\.saveButton/i }));

    // The save-triggered refetch flips the shared isLoading while the save is still in flight
    mockUsePlatformSettings.mockReturnValue({ ...defaultPlatformSettings, isLoading: true });
    rerender(
      <MemoryRouter>
        <OrgSettings />
      </MemoryRouter>
    );

    // Form must stay mounted — no full-page spinner swap mid-save
    expect(screen.queryAllByRole('switch')).toHaveLength(5);
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

    // Save persisted via the existing endpoint and refetched
    expect(callApi).toHaveBeenCalledWith('/api/org-settings-update', {
      orgId: 'org-1',
      features: expect.any(Object),
    });
    expect(refetch).toHaveBeenCalled();

    // In-button morph: the button now shows the "Saved" done label (no success toast)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /common\.saved/i })).toBeInTheDocument();
    });
    expect(toast).not.toHaveBeenCalled();
  });
});
