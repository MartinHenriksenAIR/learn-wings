import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { usePlatformSettingsAdmin } from './usePlatformSettingsAdmin';

const settings = [
  { key: 'branding', value: { platform_name: 'Test Platform' } },
  { key: 'features', value: { certificates_enabled: true } },
];

function Consumer({ testId }: { testId: string }) {
  const { data } = usePlatformSettingsAdmin();
  return <div data-testid={testId}>{(data ?? []).map((s) => s.key).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('usePlatformSettingsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/platform-settings with body {} and returns the settings array', async () => {
    mockCallApi.mockResolvedValue({ settings });

    renderWithClient(<Consumer testId="main" />);

    await waitFor(() => {
      expect(screen.getByTestId('main')).toHaveTextContent('branding,features');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/platform-settings', {});
  });

  it('two consumers share one cache entry — a single /api/platform-settings fetch', async () => {
    mockCallApi.mockResolvedValue({ settings });

    renderWithClient(
      <>
        <Consumer testId="first" />
        <Consumer testId="second" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('branding,features');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('branding,features');

    expect(mockCallApi).toHaveBeenCalledTimes(1);
  });

  it('normalizes a malformed (non-array) response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ settings: { nope: true } });

    renderWithClient(<Consumer testId="malformed" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
