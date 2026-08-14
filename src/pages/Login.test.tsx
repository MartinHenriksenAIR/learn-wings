import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockNavigate, mockChangeLanguage } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockChangeLanguage: vi.fn(),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

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
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: mockChangeLanguage },
    }),
  };
});

vi.mock('@/assets/logo-light.png', () => ({ default: 'logo-light.png' }));

vi.mock('@/lib/session-expired', () => ({
  consumeSessionExpiredNotice: vi.fn(),
  consumeIdleTimeoutNotice: vi.fn(),
}));

import Login from './Login';
import { consumeSessionExpiredNotice, consumeIdleTimeoutNotice } from '@/lib/session-expired';

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
    localStorage.clear();
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

  it('renders both front-door CTAs (not a spinner) when signed out; both fire signIn (#355)', () => {
    const signIn = vi.fn();
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null, signIn });

    render(<Login />);

    fireEvent.click(screen.getByRole('button', { name: /start free/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('language toggle switches language and persists the choice past the Entra redirect (#355)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });

    render(<Login />);

    fireEvent.click(screen.getByRole('button', { name: /dansk/i }));

    expect(mockChangeLanguage).toHaveBeenCalledWith('da');
    expect(localStorage.getItem('preferred_language')).toBe('da');
  });

  it('does not navigate while auth is still resolving', () => {
    mockUseAuth.mockReturnValue({ ...baseAuth, isLoading: true });

    render(<Login />);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Login session-expired notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseAuth.mockReturnValue({ ...baseAuth, user: null, profile: null });
  });

  it('shows the warm notice when a dead session redirected here', () => {
    vi.mocked(consumeSessionExpiredNotice).mockReturnValue(true);

    render(<Login />);

    expect(screen.getByText(/right back to where you left off/i)).toBeInTheDocument();
  });

  it('shows the inactivity notice when an idle timeout redirected here', () => {
    vi.mocked(consumeIdleTimeoutNotice).mockReturnValue(true);

    render(<Login />);

    expect(screen.getByText(/inactivity/i)).toBeInTheDocument();
  });

  it('stays quiet on a normal visit to /login', () => {
    vi.mocked(consumeSessionExpiredNotice).mockReturnValue(false);
    vi.mocked(consumeIdleTimeoutNotice).mockReturnValue(false);

    render(<Login />);

    expect(screen.queryByText(/right back to where you left off/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/inactivity/i)).not.toBeInTheDocument();
  });
});
