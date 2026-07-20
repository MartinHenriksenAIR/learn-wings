import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('@/assets/logo-light.png', () => ({ default: 'logo-light.png' }));

import Login from './Login';

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
  refreshUserContext: vi.fn(),
  setCurrentOrg: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
};

describe('Login post-auth navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('navigates to the stashed deep link instead of the role home, and clears the stash', async () => {
    sessionStorage.setItem('postLoginRedirect', '/app/community/org/posts/123?x=1#comment-9');
    mockUseAuth.mockReturnValue({ ...baseAuth, isPlatformAdmin: true });

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/community/org/posts/123?x=1#comment-9',
        { replace: true }
      );
    });
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull();
  });

  it('falls back to the platform-admin home when there is no stash', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, isPlatformAdmin: true });

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/admin/platform/organizations');
    });
  });

  it('falls back to the learner dashboard when there is no stash', async () => {
    mockUseAuth.mockReturnValue(baseAuth);

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });
  });

  it('renders the sign-in button (not a spinner) when signed out', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });

    render(<Login />);

    expect(screen.getByRole('button')).toBeDefined();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate while auth is still resolving', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, isLoading: true });

    render(<Login />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
