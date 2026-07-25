import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
}));

import { useCommunityGate } from './useCommunityGate';

function setState({ enabled, isLoading, admin }: { enabled: boolean; isLoading: boolean; admin: boolean }) {
  mockUsePlatformSettings.mockReturnValue({ features: { community_enabled: enabled }, isLoading });
  mockUseAuth.mockReturnValue({ effectiveIsPlatformAdmin: admin });
}

describe('useCommunityGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'loading' while settings are still resolving (pages render normally, no bounce)", () => {
    setState({ enabled: false, isLoading: true, admin: false });

    const { result } = renderHook(() => useCommunityGate());

    expect(result.current).toBe('loading');
  });

  it("returns 'allowed' when community is enabled", () => {
    setState({ enabled: true, isLoading: false, admin: false });

    const { result } = renderHook(() => useCommunityGate());

    expect(result.current).toBe('allowed');
  });

  it("returns 'redirect' when community is disabled", () => {
    setState({ enabled: false, isLoading: false, admin: false });

    const { result } = renderHook(() => useCommunityGate());

    expect(result.current).toBe('redirect');
  });

  it("returns 'redirect' for a platform admin when the caller did NOT opt into the bypass", () => {
    setState({ enabled: false, isLoading: false, admin: true });

    const { result } = renderHook(() => useCommunityGate());

    expect(result.current).toBe('redirect');
  });

  it("returns 'allowed' for a platform admin when the caller opted into the bypass (#89 moderation deep links)", () => {
    setState({ enabled: false, isLoading: false, admin: true });

    const { result } = renderHook(() => useCommunityGate({ allowPlatformAdmin: true }));

    expect(result.current).toBe('allowed');
  });

  it("returns 'redirect' for a non-admin even when the caller opted into the bypass", () => {
    setState({ enabled: false, isLoading: false, admin: false });

    const { result } = renderHook(() => useCommunityGate({ allowPlatformAdmin: true }));

    expect(result.current).toBe('redirect');
  });
});
