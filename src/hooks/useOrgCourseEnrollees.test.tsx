import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrgCourseEnrollees } from './useOrgCourseEnrollees';

const enrolleesResponse = {
  enrollees: [
    { user_id: 'u1', full_name: 'Alice', status: 'completed' as const, enrolled_at: '2026-01-01T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' },
    { user_id: 'u2', full_name: 'Bob', status: 'enrolled' as const, enrolled_at: '2026-01-10T00:00:00Z', completed_at: null },
  ],
};

function Consumer({ orgId, courseId }: { orgId: string | undefined; courseId: string | undefined }) {
  const { data } = useOrgCourseEnrollees(orgId, courseId);
  return (
    <div data-testid="result">
      {data ? `enrollees:${data.enrollees.length}` : 'none'}
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrgCourseEnrollees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/org-course-enrollees with the correct orgId and courseId', async () => {
    mockCallApi.mockResolvedValue(enrolleesResponse);

    renderWithClient(<Consumer orgId="org-1" courseId="course-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('enrollees:2');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/org-course-enrollees', {
      orgId: 'org-1',
      courseId: 'course-1',
    });
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue(enrolleesResponse);

    renderWithClient(<Consumer orgId={undefined} courseId="course-1" />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when courseId is undefined', async () => {
    mockCallApi.mockResolvedValue(enrolleesResponse);

    renderWithClient(<Consumer orgId="org-1" courseId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('different courseId params produce different cache entries', async () => {
    mockCallApi
      .mockResolvedValueOnce({ enrollees: [enrolleesResponse.enrollees[0]] })
      .mockResolvedValueOnce({ enrollees: enrolleesResponse.enrollees });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TwoConsumers() {
      const { data: data1 } = useOrgCourseEnrollees('org-1', 'course-1');
      const { data: data2 } = useOrgCourseEnrollees('org-1', 'course-2');
      return (
        <>
          <div data-testid="c1">{data1 ? `e:${data1.enrollees.length}` : 'none'}</div>
          <div data-testid="c2">{data2 ? `e:${data2.enrollees.length}` : 'none'}</div>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <TwoConsumers />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('c1')).toHaveTextContent('e:1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('c2')).toHaveTextContent('e:2');
    });

    // Two different course IDs = two separate fetches.
    expect(mockCallApi).toHaveBeenCalledTimes(2);
    expect(mockCallApi).toHaveBeenNthCalledWith(1, '/api/org-course-enrollees', { orgId: 'org-1', courseId: 'course-1' });
    expect(mockCallApi).toHaveBeenNthCalledWith(2, '/api/org-course-enrollees', { orgId: 'org-1', courseId: 'course-2' });
  });
});
