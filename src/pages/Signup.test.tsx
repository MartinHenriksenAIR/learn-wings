import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// Trans echoes its key plus any interpolation values so assertions can see both.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey, values }: { i18nKey: string; values?: Record<string, unknown> }) => (
    <>{values ? `${i18nKey} ${Object.values(values).join(' ')}` : i18nKey}</>
  ),
}));

vi.mock('@/assets/logo-light.png', () => ({ default: 'logo-light.png' }));

// Mocked wholesale (the real module instantiates MSAL at import time); the page
// matches on `err instanceof ApiError`, so the mock ships a compatible class.
vi.mock('@/lib/api-client', () => {
  // Named MockApiError (not ApiError) so the factory shorthand can't collide
  // with the top-level `ApiError` import binding under vitest's transform.
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return { callApi: vi.fn(), ApiError: MockApiError };
});

import Signup from './Signup';
import { callApi, ApiError } from '@/lib/api-client';

const mockCallApi = vi.mocked(callApi);

const baseAuth = {
  user: { id: 'u-1', tid: 't-1', email: 'user@x.test', name: 'User' },
  profile: { id: 'p-1', is_platform_admin: false },
  memberships: [],
  currentOrg: null,
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

const INVITE_URL = '/signup?invite=link-123';

function renderSignup(url: string = INVITE_URL) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function acceptAndWaitFor(text: string | RegExp) {
  fireEvent.click(screen.getByText('invitationAccept.acceptButton'));
  await waitFor(() => {
    expect(screen.getByText(text)).toBeDefined();
  });
}

describe('Signup (accept-invitation flow, #175)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    baseAuth.refreshUserContext.mockResolvedValue(undefined);
  });

  it('redirects to /login when there is no invite param', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });

    renderSignup('/signup');

    expect(screen.getByText('LOGIN')).toBeDefined();
  });

  it('shows a spinner (no card) while auth is resolving', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, isLoading: true });

    renderSignup();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('invitationAccept.acceptTitle')).toBeNull();
    expect(screen.queryByText('invitationAccept.invitedTitle')).toBeNull();
  });

  describe('signed out', () => {
    it('renders the generic invited card with the Microsoft sign-in button', () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });

      renderSignup();

      expect(screen.getByText('invitationAccept.invitedTitle')).toBeDefined();
      expect(screen.getByText('invitationAccept.invitedBody')).toBeDefined();
      expect(screen.getByText('invitationAccept.signInWithMicrosoft')).toBeDefined();
    });

    it('stashes the invite URL for the post-login redirect, then signs in', () => {
      const signIn = vi.fn();
      mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null, signIn });

      renderSignup();
      fireEvent.click(screen.getByText('invitationAccept.signInWithMicrosoft'));

      expect(sessionStorage.getItem('postLoginRedirect')).toBe(INVITE_URL);
      expect(signIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('signed in — accept card', () => {
    it('renders the accept card with the signed-in chip and sign-out link', () => {
      mockUseAuth.mockReturnValue(baseAuth);

      renderSignup();

      expect(screen.getByText('invitationAccept.acceptTitle')).toBeDefined();
      expect(screen.getByText('invitationAccept.signedInAs')).toBeDefined();
      expect(screen.getByText('invitationAccept.acceptButton')).toBeDefined();
      expect(screen.getByText('invitationAccept.notYouSignOut')).toBeDefined();
    });

    it('"Not you? Sign out" signs out', () => {
      const signOut = vi.fn();
      mockUseAuth.mockReturnValue({ ...baseAuth, signOut });

      renderSignup();
      fireEvent.click(screen.getByText('invitationAccept.notYouSignOut'));

      expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('calls the endpoint with the linkId from the URL', async () => {
      mockUseAuth.mockReturnValue(baseAuth);
      mockCallApi.mockResolvedValue({ kind: 'platform' });

      renderSignup();
      await acceptAndWaitFor('invitationAccept.platformTitle');

      expect(mockCallApi).toHaveBeenCalledWith('/api/invitation-accept', { linkId: 'link-123' });
    });

    it('latches against double-submit and shows the busy label while in flight', async () => {
      mockUseAuth.mockReturnValue(baseAuth);
      let resolveAccept!: (value: unknown) => void;
      mockCallApi.mockReturnValue(new Promise((resolve) => { resolveAccept = resolve; }));

      renderSignup();
      const button = screen.getByText('invitationAccept.acceptButton');
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('invitationAccept.accepting')).toBeDefined();
      });
      expect(mockCallApi).toHaveBeenCalledTimes(1);
      expect((screen.getByText('invitationAccept.accepting').closest('button') as HTMLButtonElement).disabled).toBe(true);

      resolveAccept({ kind: 'platform' });
      await waitFor(() => {
        expect(screen.getByText('invitationAccept.platformTitle')).toBeDefined();
      });
    });
  });

  describe('success', () => {
    it('org joined: shows org + localized role and refreshes the user context first', async () => {
      const refreshUserContext = vi.fn().mockResolvedValue(undefined);
      mockUseAuth.mockReturnValue({ ...baseAuth, refreshUserContext });
      mockCallApi.mockResolvedValue({
        kind: 'org', orgId: 'o-1', orgName: 'Acme', role: 'org_admin', alreadyMember: false,
      });

      renderSignup();
      await acceptAndWaitFor('invitationAccept.orgJoinedTitle');

      expect(refreshUserContext).toHaveBeenCalledTimes(1);
      // Body carries the org name and the reused localized role label — not the raw enum.
      expect(
        screen.getByText('invitationAccept.orgJoinedBody Acme orgDetail.organizationAdmin')
      ).toBeDefined();

      fireEvent.click(screen.getByText('invitationAccept.continue'));
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });

    it('platform admin: shows the platform card and Continue routes to the role home', async () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, isPlatformAdmin: true });
      mockCallApi.mockResolvedValue({ kind: 'platform' });

      renderSignup();
      await acceptAndWaitFor('invitationAccept.platformTitle');

      expect(screen.getByText('invitationAccept.platformBody')).toBeDefined();
      fireEvent.click(screen.getByText('invitationAccept.continue'));
      expect(mockNavigate).toHaveBeenCalledWith('/app/admin/platform/organizations');
    });

    it('already member: shows the org but deliberately no role', async () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, isOrgAdmin: true });
      mockCallApi.mockResolvedValue({
        kind: 'org', orgId: 'o-1', orgName: 'Acme', role: 'org_admin', alreadyMember: true,
      });

      renderSignup();
      await acceptAndWaitFor('invitationAccept.alreadyMemberTitle');

      expect(screen.getByText('invitationAccept.alreadyMemberBody Acme')).toBeDefined();
      expect(screen.queryByText(/orgDetail\.organizationAdmin/)).toBeNull();

      fireEvent.click(screen.getByText('invitationAccept.continue'));
      expect(mockNavigate).toHaveBeenCalledWith('/app/admin/org');
    });
  });

  describe('errors', () => {
    it.each([
      ['INVITE_EXPIRED', 410, 'expired'],
      ['INVITE_NOT_FOUND', 404, 'invalid'],
      ['INVITE_ALREADY_ACCEPTED', 409, 'alreadyAccepted'],
    ] as const)('%s renders its card and exits to sign-in', async (code, status, prefix) => {
      mockUseAuth.mockReturnValue(baseAuth);
      mockCallApi.mockRejectedValue(new ApiError('nope', status, code));

      renderSignup();
      await acceptAndWaitFor(`invitationAccept.${prefix}Title`);

      expect(screen.getByText(`invitationAccept.${prefix}Body`)).toBeDefined();
      fireEvent.click(screen.getByText('invitationAccept.goToSignIn'));
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('INVITE_EMAIL_MISMATCH renders the mismatch card with the current email; Sign out signs out', async () => {
      const signOut = vi.fn();
      mockUseAuth.mockReturnValue({ ...baseAuth, signOut });
      mockCallApi.mockRejectedValue(new ApiError('nope', 403, 'INVITE_EMAIL_MISMATCH'));

      renderSignup();
      await acceptAndWaitFor('invitationAccept.emailMismatchTitle');

      expect(
        screen.getByText('invitationAccept.emailMismatchBody user@x.test')
      ).toBeDefined();
      fireEvent.click(screen.getByText('invitationAccept.signOut'));
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('a codeless failure renders the generic card and Try again re-enables the accept card', async () => {
      mockUseAuth.mockReturnValue(baseAuth);
      mockCallApi.mockRejectedValue(new ApiError('boom', 500));

      renderSignup();
      await acceptAndWaitFor('invitationAccept.genericTitle');

      fireEvent.click(screen.getByText('invitationAccept.tryAgain'));
      const button = screen.getByText('invitationAccept.acceptButton').closest('button') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('a non-ApiError failure also falls back to the generic card', async () => {
      mockUseAuth.mockReturnValue(baseAuth);
      mockCallApi.mockRejectedValue(new Error('network down'));

      renderSignup();
      await acceptAndWaitFor('invitationAccept.genericTitle');

      expect(screen.getByText('invitationAccept.genericBody')).toBeDefined();
    });
  });
});
