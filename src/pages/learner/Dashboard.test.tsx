import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// --- mock api-client and storage so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn(),
}));

// --- mock CertificateCard to avoid deep imports ---
vi.mock('@/components/learner/CertificateCard', () => ({
  CertificateCard: () => <div data-testid="cert-card" />,
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

// --- usePlatformSettings mock ---
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { certificates_enabled: false } }),
}));

import LearnerDashboard from './Dashboard';

const baseAuthState = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' },
  memberships: [],
  currentOrg: null,
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

function renderDashboard() {
  return render(
    <MemoryRouter>
      <LearnerDashboard />
    </MemoryRouter>
  );
}

describe('LearnerDashboard — no-membership empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves loading and shows no-membership empty state when user has profile but no memberships', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, memberships: [], currentOrg: null });

    renderDashboard();

    // Spinner must NOT be present (loading resolved)
    expect(document.querySelector('.animate-spin')).toBeNull();

    // Empty-state title key must be rendered (t returns the key)
    expect(screen.getByText('dashboard.noMembershipTitle')).toBeInTheDocument();
    expect(screen.getByText('dashboard.noMembershipDescription')).toBeInTheDocument();
  });

  it('shows the platform-admin no-org-selected state when memberships exist but no org is selected', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'org_admin', status: 'active' }],
      currentOrg: null,
      isPlatformAdmin: true,
      effectiveIsPlatformAdmin: true,
    });

    renderDashboard();

    expect(document.querySelector('.animate-spin')).toBeNull();

    // Non-membership path uses common.noOrgSelected key
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
  });

  it('does NOT render the spinner when user is null (unauthenticated)', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: null, profile: null });

    renderDashboard();

    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});
