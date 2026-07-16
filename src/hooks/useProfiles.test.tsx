import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useProfiles } from './useProfiles';

const profiles = [
  {
    id: 'user-a',
    full_name: 'Alice',
    first_name: 'Alice',
    last_name: null,
    department: null,
    is_platform_admin: true,
    created_at: '2026-01-01T00:00:00Z',
    preferred_language: null,
  },
  {
    id: 'user-b',
    full_name: 'Bob',
    first_name: 'Bob',
    last_name: null,
    department: 'Engineering',
    is_platform_admin: false,
    created_at: '2026-01-02T00:00:00Z',
    preferred_language: null,
  },
];

function Consumer({ testId, enabled }: { testId: string; enabled?: boolean }) {
  const { data } = useProfiles(enabled === undefined ? {} : { enabled });
  return <div data-testid={testId}>{(data ?? []).map((p) => p.full_name).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('two consumers share one cache entry — a single /api/profiles fetch', async () => {
    mockCallApi.mockResolvedValue({ profiles });

    renderWithClient(
      <>
        <Consumer testId="first" />
        <Consumer testId="second" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('Alice,Bob');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('Alice,Bob');

    // The whole point of the shared hook: one network call, not one per consumer.
    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/profiles', {});
  });

  it('does not fetch when enabled is false', async () => {
    mockCallApi.mockResolvedValue({ profiles });

    renderWithClient(<Consumer testId="gated" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed (non-array) response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ profiles: { nope: true } });

    renderWithClient(<Consumer testId="malformed" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
