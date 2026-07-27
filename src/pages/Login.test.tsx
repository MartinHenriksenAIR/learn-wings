import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// Resolve keys against the real en.json rather than echoing an inline default.
// The previous stub returned `t()`'s second argument, which meant the button
// assertion below passed on a hard-coded English literal even though
// `auth.signInWithMicrosoft` was missing from both locale files (#300). Reading
// the shipped copy makes a missing key render as the raw key and fail here.
vi.mock('react-i18next', async () => {
  const en = (await import('@/i18n/locales/en.json')).default;
  const translate = (key: string): string => {
    let node: unknown = en;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return key;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? node : key;
  };
  return { useTranslation: () => ({ t: translate }) };
});

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

  it('routes a plain learner with no assessment level and no skip to the assessment (#117)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      profile: { ...baseAuth.profile, assessment_level: null, assessment_skipped_at: null },
    });

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/assessment', { replace: true });
    });
  });

  it('falls back to the learner dashboard when the learner already has an assessment level', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      profile: { ...baseAuth.profile, assessment_level: 'basic', assessment_skipped_at: null },
    });

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });
  });

  it('falls back to the learner dashboard when the learner has a skip timestamp', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      profile: {
        ...baseAuth.profile,
        assessment_level: null,
        assessment_skipped_at: '2026-07-01T00:00:00Z',
      },
    });

    render(<Login />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
    });
  });

  it('renders the shared Microsoft sign-in button (not a spinner) when signed out, wired to signIn', () => {
    const signIn = vi.fn();
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null, signIn });

    render(<Login />);

    const button = screen.getByRole('button', { name: /sign in with microsoft/i });
    fireEvent.click(button);

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate while auth is still resolving', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, isLoading: true });

    render(<Login />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
