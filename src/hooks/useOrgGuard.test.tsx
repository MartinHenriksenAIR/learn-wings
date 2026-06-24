import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import { useOrgGuard } from './useOrgGuard';

const user = { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' };
const profile = { id: 'p-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' };
const org = { id: 'org-1', name: 'Test Org', slug: 'test-org' };

describe('useOrgGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'loading' while a signed-in user's context has not resolved (profile null)", () => {
    mockUseAuth.mockReturnValue({ user, profile: null, currentOrg: null });

    const { result } = renderHook(() => useOrgGuard());

    expect(result.current).toBe('loading');
  });

  it("returns 'no-org' when context is resolved but no org is available", () => {
    mockUseAuth.mockReturnValue({ user, profile, currentOrg: null });

    const { result } = renderHook(() => useOrgGuard());

    expect(result.current).toBe('no-org');
  });

  it("returns 'no-org' when nobody is signed in (nothing to wait for)", () => {
    mockUseAuth.mockReturnValue({ user: null, profile: null, currentOrg: null });

    const { result } = renderHook(() => useOrgGuard());

    expect(result.current).toBe('no-org');
  });

  it("returns 'ready' when an org is selected", () => {
    mockUseAuth.mockReturnValue({ user, profile, currentOrg: org });

    const { result } = renderHook(() => useOrgGuard());

    expect(result.current).toBe('ready');
  });
});
