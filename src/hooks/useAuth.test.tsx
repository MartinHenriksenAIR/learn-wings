import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';

// Mock MSAL before importing the hook
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
// Keep the real ApiError so the hook's `err instanceof ApiError` classification
// (401 → 'auth', else → 'network') is exercised against the actual class.
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, callApi: mockCallApi };
});

// The provider reads the browser-derived language off the i18n singleton to
// send it on the user-context call (#226). Pin it to 'da' so the assertion is
// deterministic regardless of the jsdom navigator language.
vi.mock('@/i18n', () => ({ default: { resolvedLanguage: 'da' } }));

import { AuthProvider, useAuth } from './useAuth';
import { ApiError } from '@/lib/api-client';

const mockAccount = {
  localAccountId: 'local-123',
  tenantId: 'tid-456',
  username: 'user@contoso.com',
  name: 'Test User',
  idTokenClaims: { oid: 'entra-oid-123' },
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseMsal.mockReturnValue({
      instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
      accounts: [],
      inProgress: 'none',
    });
    mockUseAccount.mockReturnValue(null);
  });

  it('throws when used outside AuthProvider', () => {
    // Suppress React error boundary noise
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    consoleSpy.mockRestore();
  });

  it('user is null when no MSAL account is present', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it('user is populated from MSAL account claims', () => {
    mockUseMsal.mockReturnValue({
      instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
      accounts: [mockAccount],
      inProgress: 'none',
    });
    mockUseAccount.mockReturnValue(mockAccount);
    mockCallApi.mockResolvedValue({ profile: { id: 'p-1', is_platform_admin: false }, memberships: [] });

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user?.id).toBe('entra-oid-123');
    expect(result.current.user?.email).toBe('user@contoso.com');
  });

  it('sends the browser-resolved language in the user-context request (#226)', async () => {
    mockUseMsal.mockReturnValue({
      instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
      accounts: [mockAccount],
      inProgress: 'none',
    });
    mockUseAccount.mockReturnValue(mockAccount);
    mockCallApi.mockResolvedValue({ profile: { id: 'p-1', is_platform_admin: false }, memberships: [] });

    renderHook(() => useAuth(), { wrapper });

    // The provisioning call must carry the detected language so the server can
    // stamp it on a first-login profile (mocked to 'da' above).
    await waitFor(() =>
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/user-context',
        expect.objectContaining({ language: 'da' }),
      ),
    );
  });

  it('signIn calls loginRedirect', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => { result.current.signIn(); });
    expect(mockLoginRedirect).toHaveBeenCalledOnce();
  });

  it('signOut calls logoutRedirect', async () => {
    // In real usage logoutRedirect navigates the browser away, so we only verify
    // it was called — we don't check state afterwards (the page won't exist).
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => { result.current.signOut(); });

    expect(mockLogoutRedirect).toHaveBeenCalledOnce();
  });

  it('signOut clears the persisted viewMode and any stashed redirect (same-tab next login must start clean)', async () => {
    sessionStorage.setItem('viewMode', 'learner');
    sessionStorage.setItem('postLoginRedirect', '/app/community/org/posts/123');

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => { result.current.signOut(); });

    expect(sessionStorage.getItem('viewMode')).toBeNull();
    expect(sessionStorage.getItem('postLoginRedirect')).toBeNull();
  });

  describe('isLoading covers user-context resolution (#16)', () => {
    const msalWithAccount = () => {
      mockUseMsal.mockReturnValue({
        instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
        accounts: [mockAccount],
        inProgress: 'none',
      });
      mockUseAccount.mockReturnValue(mockAccount);
    };

    it('stays loading until the user-context fetch resolves, then exposes the profile', async () => {
      msalWithAccount();
      let resolveCtx!: (v: unknown) => void;
      mockCallApi.mockReturnValue(new Promise((r) => { resolveCtx = r; }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      // MSAL is idle but the profile fetch is in flight — route guards must NOT
      // treat this window as "not authorized" (the refresh→dashboard bug).
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveCtx({ profile: { id: 'p-1', is_platform_admin: false }, memberships: [] });
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.profile?.id).toBe('p-1');
    });

    it('clears loading even when the user-context fetch fails', async () => {
      msalWithAccount();
      mockCallApi.mockRejectedValue(new Error('api down'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.profile).toBeNull();
    });

    it('is not loading when signed out (no MSAL account)', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockCallApi).not.toHaveBeenCalled();
    });
  });

  describe('contextError surfaces a failed user-context load (#232)', () => {
    const msalWithAccount = () => {
      mockUseMsal.mockReturnValue({
        instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
        accounts: [mockAccount],
        inProgress: 'none',
      });
      mockUseAccount.mockReturnValue(mockAccount);
    };

    it('no contextError while the fetch is in flight or on success', async () => {
      msalWithAccount();
      let resolveCtx!: (v: unknown) => void;
      mockCallApi.mockReturnValue(new Promise((r) => { resolveCtx = r; }));

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.contextError).toBeNull();

      await act(async () => {
        resolveCtx({ profile: { id: 'p-1', is_platform_admin: false }, memberships: [] });
      });
      expect(result.current.contextError).toBeNull();
    });

    it("logs and sets contextError='network' when the fetch fails with a non-401 error", async () => {
      msalWithAccount();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('api down');
      mockCallApi.mockRejectedValue(err);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.contextError).toBe('network'));
      expect(result.current.profile).toBeNull();
      // The failure must be logged, not swallowed.
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load user context', err);
      consoleSpy.mockRestore();
    });

    it("classifies an ApiError with status 401 as contextError='auth'", async () => {
      msalWithAccount();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCallApi.mockRejectedValue(new ApiError('Unauthorized', 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.contextError).toBe('auth'));
      consoleSpy.mockRestore();
    });

    it('classifies a non-401 ApiError (e.g. 500) as network', async () => {
      msalWithAccount();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCallApi.mockRejectedValue(new ApiError('Server error', 500));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.contextError).toBe('network'));
      consoleSpy.mockRestore();
    });

    it('clears contextError when a retry (refreshUserContext) succeeds', async () => {
      msalWithAccount();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCallApi.mockRejectedValueOnce(new Error('transient blip'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.contextError).toBe('network'));

      // Retry: next call succeeds → error cleared, profile populated.
      mockCallApi.mockResolvedValueOnce({
        profile: { id: 'p-1', is_platform_admin: true },
        memberships: [],
      });
      await act(async () => { await result.current.refreshUserContext(); });

      expect(result.current.contextError).toBeNull();
      expect(result.current.profile?.id).toBe('p-1');
      consoleSpy.mockRestore();
    });
  });

  describe('viewMode persistence (#16)', () => {
    beforeEach(() => {
      mockUseMsal.mockReturnValue({
        instance: { loginRedirect: mockLoginRedirect, logoutRedirect: mockLogoutRedirect },
        accounts: [mockAccount],
        inProgress: 'none',
      });
      mockUseAccount.mockReturnValue(mockAccount);
      // Keep the context fetch pending so no state updates leak past test end.
      mockCallApi.mockReturnValue(new Promise(() => {}));
    });

    it('initializes viewMode from sessionStorage so it survives a reload', () => {
      sessionStorage.setItem('viewMode', 'learner');

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.viewMode).toBe('learner');
    });

    it('defaults viewMode to platform_admin when nothing is stored', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.viewMode).toBe('platform_admin');
    });

    it('ignores an invalid stored viewMode value', () => {
      sessionStorage.setItem('viewMode', 'garbage');

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.viewMode).toBe('platform_admin');
    });

    it('persists viewMode changes to sessionStorage', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      act(() => { result.current.setViewMode('org_admin'); });

      expect(result.current.viewMode).toBe('org_admin');
      expect(sessionStorage.getItem('viewMode')).toBe('org_admin');
    });
  });
});
