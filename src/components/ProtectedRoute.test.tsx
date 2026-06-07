import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
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
});
