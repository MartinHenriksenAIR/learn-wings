import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrgAnalyticsData } from './useOrgAnalyticsData';

const analyticsResponse = {
  members: [
    { user_id: 'u1', full_name: 'Alice', email: 'a@test.com', department: 'Engineering' },
  ],
  enrollments: [
    { user_id: 'u1', status: 'completed', course_id: 'c1' },
  ],
  quizAttempts: [
    { user_id: 'u1', score: 85 },
  ],
};

function Consumer({ orgId }: { orgId: string | undefined }) {
  const { data } = useOrgAnalyticsData(orgId);
  return (
    <div data-testid="result">
      {data ? `members:${data.members.length}` : 'none'}
    </div>
  );
}

function GatedConsumer({ orgId, enabled }: { orgId: string | undefined; enabled: boolean }) {
  const { data } = useOrgAnalyticsData(orgId, { enabled });
  return (
    <div data-testid="gated">
      {data ? `members:${data.members.length}` : 'none'}
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrgAnalyticsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/org-analytics-data with the correct orgId body', async () => {
    mockCallApi.mockResolvedValue(analyticsResponse);

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('members:1');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/org-analytics-data', { orgId: 'org-1' });
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue(analyticsResponse);

    renderWithClient(<Consumer orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('result')).toHaveTextContent('none');
  });

  it('does not fetch when enabled is false', async () => {
    mockCallApi.mockResolvedValue(analyticsResponse);

    renderWithClient(<GatedConsumer orgId="org-1" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('gated')).toHaveTextContent('none');
  });
});
