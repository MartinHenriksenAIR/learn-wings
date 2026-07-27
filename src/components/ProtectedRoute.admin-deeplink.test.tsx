// Regression tests for #79: cold-loading an admin deep link must never bounce
// to the dashboard just because the user-context fetch hasn't resolved yet.
// These exercise the REAL AuthProvider + ProtectedRoute together (unlike
// ProtectedRoute.test.tsx, which mocks useAuth wholesale) so the race between
// the MSAL account appearing and /api/user-context resolving is covered.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { mockLoginRedirect, mockLogoutRedirect, mockUseMsal, mockUseAccount } = vi.hoisted(() => ({
  mockLoginRedirect: vi.fn().mockResolvedValue(undefined),
  mockLogoutRedirect: vi.fn().mockResolvedValue(undefined),
  mockUseMsal: vi.fn(),
  mockUseAccount: vi.fn(),
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: mockUseMsal,
  useAccount: mockUseAccount,
}));

vi.mock('@azure/msal-browser', () => ({
  InteractionStatus: { None: 'none' },
}));

vi.mock('@/lib/msal-config', () => ({
  apiScopes: ['api://test/access_as_user'],
}));

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
// Preserve the real ApiError export so useAuth's 401-vs-network classification runs.
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, callApi: mockCallApi };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The real AuthProvider reads i18n.resolvedLanguage to pass the UI language to
// /api/user-context (#226/#229). Mock the singleton so the real @/i18n module
// (which .use()s initReactI18next) isn't initialized in this unit test.
vi.mock('@/i18n', () => ({ default: { resolvedLanguage: 'en' } }));

import { AuthProvider } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api-client';
import { ProtectedRoute } from './ProtectedRoute';

const mockAccount = {
  localAccountId: 'local-123',
  tenantId: 'tid-456',
  username: 'admin@contoso.com',
  name: 'Admin User',
  idTokenClaims: { oid: 'entra-oid-123' },
};

function setMsal({ account, inProgress }: { account: typeof mockAccount | null; inProgress: string }) {
  mockUseMsal.mockReturnValue({
    instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
    accounts: account ? [account] : [],
    inProgress,
  });
  mockUseAccount.mockReturnValue(account);
}

function AdminApp({ guard }: { guard: { requirePlatformAdmin?: boolean; requireOrgAdmin?: boolean } }) {
  return (
    <MemoryRouter initialEntries={['/app/admin/platform/organizations/org-1']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/app/admin/platform/organizations/:orgId"
            element={<ProtectedRoute {...guard}><div>ORG DETAIL</div></ProtectedRoute>}
          />
          <Route path="/app/dashboard" element={<div>DASHBOARD</div>} />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

const spinner = () => document.querySelector('.animate-spin');

describe('admin deep-link cold load (#79)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders loading (not a redirect) while the user context is pending, then the page once admin=true resolves', async () => {
    // Hard refresh on the deep link: account already cached at mount,
    // /api/user-context still in flight.
    setMsal({ account: mockAccount, inProgress: 'none' });
    let resolveCtx!: (v: unknown) => void;
    mockCallApi.mockReturnValue(new Promise((r) => { resolveCtx = r; }));

    render(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    expect(spinner()).not.toBeNull();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
    expect(screen.queryByText('ORG DETAIL')).toBeNull();

    await act(async () => {
      resolveCtx({ profile: { id: 'p-1', is_platform_admin: true }, memberships: [] });
    });

    expect(screen.getByText('ORG DETAIL')).toBeInTheDocument();
  });

  it('does not bounce to the dashboard when the MSAL account materializes after mount (cold login return)', async () => {
    // Phase 1: MSAL is still processing the redirect back from Entra — no
    // account in the provider state yet.
    setMsal({ account: null, inProgress: 'handleRedirect' });
    let resolveCtx!: (v: unknown) => void;
    mockCallApi.mockReturnValue(new Promise((r) => { resolveCtx = r; }));

    const view = render(<AdminApp guard={{ requirePlatformAdmin: true }} />);
    expect(spinner()).not.toBeNull();

    // Phase 2: redirect handled — account present, MSAL idle, context fetch
    // in flight. The guard must keep waiting, not redirect.
    setMsal({ account: mockAccount, inProgress: 'none' });
    view.rerender(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    expect(screen.queryByText('DASHBOARD')).toBeNull();
    expect(spinner()).not.toBeNull();

    // Phase 3: context resolves with admin=true → the deep link renders.
    await act(async () => {
      resolveCtx({ profile: { id: 'p-1', is_platform_admin: true }, memberships: [] });
    });

    expect(screen.getByText('ORG DETAIL')).toBeInTheDocument();
  });

  it('redirects to the dashboard once the context resolves with admin=false', async () => {
    setMsal({ account: mockAccount, inProgress: 'none' });
    mockCallApi.mockResolvedValue({ profile: { id: 'p-1', is_platform_admin: false }, memberships: [] });

    render(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());
    expect(screen.queryByText('ORG DETAIL')).toBeNull();
  });

  it('shows the retry state (not a dashboard bounce) when an admin deep link fails to load context (#232)', async () => {
    // End-to-end through the real AuthProvider: the account is cached, but
    // /api/user-context rejects. Pre-fix this settled as profile=null →
    // !isPlatformAdmin → silent redirect to the learner dashboard. The admin
    // must now see the retry state instead.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setMsal({ account: mockAccount, inProgress: 'none' });
    mockCallApi.mockRejectedValue(new Error('bootstrap 500'));

    render(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    await waitFor(() => expect(screen.getByText('contextError.title')).toBeInTheDocument());
    expect(screen.getByText('contextError.retry')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).toBeNull();
    consoleSpy.mockRestore();
  });

  it("shows the 'sign in again' affordance when an admin deep link fails with a 401 (#232)", async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setMsal({ account: mockAccount, inProgress: 'none' });
    mockCallApi.mockRejectedValue(new ApiError('Unauthorized', 401));

    render(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    await waitFor(() => expect(screen.getByText('contextError.signInAgain')).toBeInTheDocument());
    expect(screen.queryByText('DASHBOARD')).toBeNull();
    consoleSpy.mockRestore();
  });

  it('a successful retry after a failed admin deep-link load renders the page (#232)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setMsal({ account: mockAccount, inProgress: 'none' });
    mockCallApi.mockRejectedValueOnce(new Error('transient'));

    render(<AdminApp guard={{ requirePlatformAdmin: true }} />);

    await waitFor(() => expect(screen.getByText('contextError.retry')).toBeInTheDocument());

    // Retry succeeds with admin=true → the deep-linked page renders.
    mockCallApi.mockResolvedValueOnce({
      profile: { id: 'p-1', is_platform_admin: true },
      memberships: [],
    });
    await act(async () => {
      fireEvent.click(screen.getByText('contextError.retry'));
    });

    await waitFor(() => expect(screen.getByText('ORG DETAIL')).toBeInTheDocument());
    consoleSpy.mockRestore();
  });

  it('requireOrgAdmin waits for the context the same way instead of redirecting', async () => {
    setMsal({ account: null, inProgress: 'handleRedirect' });
    let resolveCtx!: (v: unknown) => void;
    mockCallApi.mockReturnValue(new Promise((r) => { resolveCtx = r; }));

    const view = render(<AdminApp guard={{ requireOrgAdmin: true }} />);

    setMsal({ account: mockAccount, inProgress: 'none' });
    view.rerender(<AdminApp guard={{ requireOrgAdmin: true }} />);

    expect(screen.queryByText('DASHBOARD')).toBeNull();
    expect(spinner()).not.toBeNull();

    await act(async () => {
      resolveCtx({
        profile: { id: 'p-1', is_platform_admin: false },
        memberships: [{ role: 'org_admin', status: 'active', organization: { id: 'org-1', name: 'Org' } }],
      });
    });

    expect(screen.getByText('ORG DETAIL')).toBeInTheDocument();
  });
});
