import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useCourseCategories } from './useCourseCategories';

const categories = [
  { id: 'cat-a', name_en: 'Leadership', name_da: 'Ledelse', slug: 'leadership', sort_order: 0, created_at: '2026-01-01T00:00:00Z' },
  { id: 'cat-b', name_en: 'Strategy', name_da: 'Strategi', slug: 'strategy', sort_order: 1, created_at: '2026-01-02T00:00:00Z' },
];

function Consumer({ testId, enabled }: { testId: string; enabled?: boolean }) {
  const { data } = useCourseCategories(enabled === undefined ? {} : { enabled });
  return <div data-testid={testId}>{(data ?? []).map((c) => c.name_en).join(',')}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useCourseCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('two consumers share one cache entry — a single /api/course-categories fetch', async () => {
    mockCallApi.mockResolvedValue({ categories });

    renderWithClient(
      <>
        <Consumer testId="first" />
        <Consumer testId="second" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('first')).toHaveTextContent('Leadership,Strategy');
    });
    expect(screen.getByTestId('second')).toHaveTextContent('Leadership,Strategy');

    // The whole point of the shared hook: one network call, not one per consumer.
    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/course-categories', {});
  });

  it('does not fetch when enabled is false', async () => {
    mockCallApi.mockResolvedValue({ categories });

    renderWithClient(<Consumer testId="gated" enabled={false} />);

    // Let pending microtasks settle, then assert no request fired.
    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('');
  });

  it('normalizes a malformed (non-array) response to an empty list', async () => {
    mockCallApi.mockResolvedValue({ categories: { nope: true } });

    renderWithClient(<Consumer testId="malformed" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('malformed')).toHaveTextContent('');
  });
});
