import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrganizations } from './useOrganizations';

const orgs = [
  { id: 'org-a', name: 'Alpha Org', slug: 'alpha', logo_url: null, seat_limit: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'org-b', name: 'Beta Org', slug: 'beta', logo_url: null, seat_limit: null, created_at: '2026-01-02T00:00:00Z' },
];

function Consumer({ testId, enabled }: { testId: string; enabled?: boolean }) {
  const { data } = useOrganizations(enabled === undefined ? {} : { enabled });
  return <div data-testid={testId}>{(data ?? []).map((o) => o.name).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrganizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('two consumers share one cache entry — a single /api/organizations fetch', async () => {
    mockCallApi.mockResolvedValue({ organizations: orgs });

    renderWithClient(
      <>
        <Consumer testId="first" />
        <Consumer testId="second" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('Alpha Org,Beta Org');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('Alpha Org,Beta Org');

    // The whole point of the shared hook: one network call, not one per consumer.
    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/organizations', {});
  });

  it('does not fetch when enabled is false', async () => {
    mockCallApi.mockResolvedValue({ organizations: orgs });

    renderWithClient(<Consumer testId="gated" enabled={false} />);

    // Let pending microtasks settle, then assert no request fired.
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed (non-array) response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ organizations: { nope: true } });

    renderWithClient(<Consumer testId="malformed" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
