import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useUserProgress } from './useUserProgress';

const progressResponse = {
  courses: [
    {
      enrollmentId: 'e1',
      courseId: 'c1',
      courseTitle: 'AI Basics',
      courseLevel: 'basic',
      enrollmentStatus: 'completed',
      enrolledAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-02-01T00:00:00Z',
      modules: [],
      totalLessons: 5,
      completedLessons: 5,
      quizAttempts: [],
    },
  ],
};

function Consumer({
  orgId,
  userId,
  enabled,
}: {
  orgId: string | undefined;
  userId: string | undefined;
  enabled?: boolean;
}) {
  const { data } = useUserProgress(orgId, userId, enabled !== undefined ? { enabled } : {});
  return (
    <div data-testid="result">
      {data ? `courses:${data.courses.length}` : 'none'}
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useUserProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/user-progress with the correct orgId and userId', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId="org-1" userId="user-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('courses:1');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/user-progress', {
      orgId: 'org-1',
      userId: 'user-1',
    });
  });

  it('does not fetch when enabled is false (dialog closed)', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId="org-1" userId="user-1" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('result')).toHaveTextContent('none');
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId={undefined} userId="user-1" />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when userId is undefined', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId="org-1" userId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('different userId params produce different cache entries', async () => {
    mockCallApi
      .mockResolvedValueOnce({ courses: [progressResponse.courses[0]] })
      .mockResolvedValueOnce({ courses: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TwoUsers() {
      const { data: data1 } = useUserProgress('org-1', 'user-1');
      const { data: data2 } = useUserProgress('org-1', 'user-2');
      return (
        <>
          <div data-testid="u1">{data1 ? `c:${data1.courses.length}` : 'none'}</div>
          <div data-testid="u2">{data2 ? `c:${data2.courses.length}` : 'none'}</div>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <TwoUsers />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('u1')).toHaveTextContent('c:1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('u2')).toHaveTextContent('c:0');
    });

    // Two different user IDs = two separate fetches with different cache keys.
    expect(mockCallApi).toHaveBeenCalledTimes(2);
    expect(mockCallApi).toHaveBeenNthCalledWith(1, '/api/user-progress', { orgId: 'org-1', userId: 'user-1' });
    expect(mockCallApi).toHaveBeenNthCalledWith(2, '/api/user-progress', { orgId: 'org-1', userId: 'user-2' });
  });
});
