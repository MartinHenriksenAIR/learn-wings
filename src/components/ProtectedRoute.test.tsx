import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import { ProtectedRoute } from './ProtectedRoute';

const baseAuth = {
  user: { id: 'u-1', tid: 't-1', email: 'user@x.test', name: 'User' },
  profile: { id: 'p-1', is_platform_admin: false },
  memberships: [],
  currentOrg: null,
  isPlatformAdmin: false,
  isOrgAdmin: false,
  isLoading: false,
  contextError: null as 'auth' | 'network' | null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn(),
  setCurrentOrg: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
};

const DEEP_URL = '/app/community/org/posts/123?x=1#comment-9';

function renderAt(url: string, routeProps: Record<string, boolean> = {}) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/app/community/org/posts/:postId"
          element={<ProtectedRoute {...routeProps}><div>POST</div></ProtectedRoute>}
        />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/app/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('stashes the intended URL before redirecting an unauthenticated user to /login', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });

    renderAt(DEEP_URL);

    expect(screen.getByText('LOGIN')).toBeDefined();
    expect(sessionStorage.getItem('postLoginRedirect')).toBe(DEEP_URL);
  });

  it('shows a spinner instead of deciding while auth is still loading', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null, isLoading: true });

    renderAt(DEEP_URL);

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('LOGIN')).toBeNull();
    expect(screen.queryByText('POST')).toBeNull();
  });

  it('renders children for an authenticated user without stashing anything', () => {
    mockUseAuth.mockReturnValue(baseAuth);

    renderAt(DEEP_URL);

    expect(screen.getByText('POST')).toBeDefined();
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull();
  });

  it('does not stash on a role-based redirect to the dashboard', () => {
    mockUseAuth.mockReturnValue(baseAuth);

    renderAt(DEEP_URL, { requireOrgAdmin: true });

    expect(screen.getByText('DASHBOARD')).toBeDefined();
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull();
  });

  describe('contextError shows a retry state instead of swallowing the failure (#232)', () => {
    it("renders the error + a retry button on a 'network' contextError (no redirect, no children)", () => {
      mockUseAuth.mockReturnValue({ ...baseAuth, profile: null, contextError: 'network' });

      renderAt(DEEP_URL);

      expect(screen.getByText('contextError.title')).toBeDefined();
      expect(screen.getByText('contextError.retry')).toBeDefined();
      expect(screen.queryByText('POST')).toBeNull();
      expect(screen.queryByText('DASHBOARD')).toBeNull();
      expect(screen.queryByText('LOGIN')).toBeNull();
    });

    it('retry click calls refreshUserContext', () => {
      const refreshUserContext = vi.fn();
      mockUseAuth.mockReturnValue({ ...baseAuth, profile: null, contextError: 'network', refreshUserContext });

      renderAt(DEEP_URL);
      fireEvent.click(screen.getByText('contextError.retry'));

      expect(refreshUserContext).toHaveBeenCalledOnce();
    });

    it("offers a 'sign in again' affordance on an 'auth' contextError", () => {
      const signIn = vi.fn();
      mockUseAuth.mockReturnValue({ ...baseAuth, profile: null, contextError: 'auth', signIn });

      renderAt(DEEP_URL);
      expect(screen.getByText('contextError.signInAgain')).toBeDefined();
      fireEvent.click(screen.getByText('contextError.signInAgain'));
      expect(signIn).toHaveBeenCalledOnce();
    });

    it('does NOT silently demote/redirect a platform admin whose context failed — shows retry instead', () => {
      // A platform admin (requirePlatformAdmin route) whose context blipped:
      // isPlatformAdmin is false only because the load failed. The old code read
      // `!isPlatformAdmin` and bounced to the learner dashboard; now it must not.
      mockUseAuth.mockReturnValue({
        ...baseAuth,
        profile: null,
        isPlatformAdmin: false,
        contextError: 'network',
      });

      renderAt(DEEP_URL, { requirePlatformAdmin: true });

      expect(screen.getByText('contextError.title')).toBeDefined();
      expect(screen.getByText('contextError.retry')).toBeDefined();
      expect(screen.queryByText('DASHBOARD')).toBeNull();
    });
  });
});
