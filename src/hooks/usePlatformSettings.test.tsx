import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the auth + api dependencies so the provider runs in isolation.
const { mockUseAuth, mockCallApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockCallApi: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/lib/api-client', () => ({ callApi: mockCallApi }));

import { PlatformSettingsProvider } from './usePlatformSettings';

describe('usePlatformSettings — branding defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any inline CSS vars left by a previous render.
    document.documentElement.removeAttribute('style');
  });

  it('applies navy branding defaults when no user is signed in', async () => {
    mockUseAuth.mockReturnValue({ user: null, currentOrg: null });

    render(
      <PlatformSettingsProvider>
        <div />
      </PlatformSettingsProvider>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--primary'),
      ).toBe('228 80% 31%');
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--accent')).toBe('226 62% 96%');
    expect(root.style.getPropertyValue('--sidebar-primary')).toBe('228 80% 31%');
    expect(root.style.getPropertyValue('--sidebar-ring')).toBe('228 80% 31%');
    expect(root.style.getPropertyValue('--sidebar-accent')).toBe('226 62% 96%');
  });

  it('falls back to navy when platform settings load with empty branding', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'entra-oid-1' },
      currentOrg: null,
    });
    // Empty settings array => provider keeps defaults (the regression path).
    mockCallApi.mockResolvedValue({ settings: [] });

    render(
      <PlatformSettingsProvider>
        <div />
      </PlatformSettingsProvider>,
    );

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--primary'),
      ).toBe('228 80% 31%');
    });

    expect(
      document.documentElement.style.getPropertyValue('--accent'),
    ).toBe('226 62% 96%');
  });
});
