import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useAiChampions } from './useAiChampions';

const champions = [{ user_id: 'u-1' }, { user_id: 'u-2' }];

function Consumer({ testId, orgId }: { testId: string; orgId?: string }) {
  const { data } = useAiChampions(orgId);
  return <div data-testid={testId}>{(data ?? []).map((c) => c.user_id).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useAiChampions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('two consumers share one cache entry — a single /api/ai-champions fetch', async () => {
    mockCallApi.mockResolvedValue({ champions });

    renderWithClient(
      <>
        <Consumer testId="first" orgId="org-1" />
        <Consumer testId="second" orgId="org-1" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('u-1,u-2');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('u-1,u-2');

    // The whole point of the shared hook: one network call, not one per consumer.
    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/ai-champions', { orgId: 'org-1' });
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue({ champions });

    renderWithClient(<Consumer testId="gated" />);

    // Let pending microtasks settle, then assert no request fired.
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed (non-array) response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ champions: { nope: true } });

    renderWithClient(<Consumer testId="malformed" orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
