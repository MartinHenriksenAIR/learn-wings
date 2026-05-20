import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
vi.mock('@/lib/api-client', () => ({ callApi: mockCallApi }));

import { AuthProvider, useAuth } from './useAuth';

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
});
