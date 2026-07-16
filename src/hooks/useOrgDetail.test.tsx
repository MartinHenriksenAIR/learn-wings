import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi, MockApiError } = vi.hoisted(() => {
  class ApiErrorClass extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return { mockCallApi: vi.fn(), MockApiError: ApiErrorClass };
});

vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
  ApiError: MockApiError,
}));

import { useOrgDetail } from './useOrgDetail';

const org = {
  id: 'org-a',
  name: 'Alpha Org',
  slug: 'alpha',
  logo_url: null,
  seat_limit: null,
  created_at: '2026-01-01T00:00:00Z',
};

function Consumer({ testId, orgId }: { testId: string; orgId: string | undefined }) {
  const { data } = useOrgDetail(orgId);
  return <div data-testid={testId}>{data?.name ?? 'none'}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrgDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /api/organizations with { orgId }', async () => {
    mockCallApi.mockResolvedValue({ organization: org });

    renderWithClient(<Consumer testId="result" orgId="org-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Alpha Org');
    });

    expect(mockCallApi).toHaveBeenCalledWith('/api/organizations', { orgId: 'org-a' });
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue({ organization: org });

    renderWithClient(<Consumer testId="gated" orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('none');
  });

  it('resolves to null on 404 rather than throwing', async () => {
    mockCallApi.mockRejectedValue(new MockApiError('Not found', 404));

    let capturedData: ReturnType<typeof useOrgDetail>['data'] = undefined;
    let capturedError: unknown = undefined;

    function Inspector() {
      const { data, error } = useOrgDetail('org-missing');
      capturedData = data;
      capturedError = error;
      return null;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Inspector />
      </QueryClientProvider>
    );

    await waitFor(() => {
      // data should be null (not undefined) after a 404
      expect(capturedData).toBeNull();
    });

    // 404 must NOT propagate as an error to TanStack Query
    expect(capturedError).toBeNull();
  });

  it('propagates non-404 errors to the query error state', async () => {
    mockCallApi.mockRejectedValue(new MockApiError('Server error', 500));

    let capturedError: unknown = undefined;

    function Inspector() {
      const { error } = useOrgDetail('org-a');
      capturedError = error;
      return null;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Inspector />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(capturedError).toBeTruthy();
    });
  });
});
