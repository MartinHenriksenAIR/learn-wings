import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the auth + api dependencies so the provider runs in isolation.
const { mockUseAuth, mockCallApi } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockCallApi: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }));
vi.mock('@/lib/api-client', () => ({ callApi: mockCallApi }));

import { PlatformSettingsProvider, usePlatformSettings } from './usePlatformSettings';

function FeatureProbe() {
  const { features, isLoading } = usePlatformSettings();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="community">{String(features.community_enabled)}</span>
      <span data-testid="reviews">{String(features.course_reviews_enabled)}</span>
    </div>
  );
}

describe('usePlatformSettings — feature flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes default feature flags when no user is signed in (no fetch)', async () => {
    mockUseAuth.mockReturnValue({ user: null, currentOrg: null });

    render(
      <PlatformSettingsProvider>
        <FeatureProbe />
      </PlatformSettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    // Defaults: community enabled, course reviews disabled.
    expect(screen.getByTestId('community')).toHaveTextContent('true');
    expect(screen.getByTestId('reviews')).toHaveTextContent('false');
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('merges platform feature flags from the API when signed in', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'entra-oid-1' }, currentOrg: null });
    mockCallApi.mockResolvedValue({
      settings: [{ key: 'features', value: { community_enabled: false } }],
    });

    render(
      <PlatformSettingsProvider>
        <FeatureProbe />
      </PlatformSettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('community')).toHaveTextContent('false');
    });
    // A flag the API didn't touch keeps its default.
    expect(screen.getByTestId('reviews')).toHaveTextContent('false');
  });
});
