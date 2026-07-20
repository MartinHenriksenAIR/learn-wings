import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrgCourseOrgBreakdown } from './useOrgCourseOrgBreakdown';

const breakdownResponse = {
  orgs: [
    { org_id: 'o1', org_name: 'Acme', enrolled: 64, completed: 20 },
    { org_id: 'o2', org_name: 'Globex', enrolled: 51, completed: 12 },
  ],
};

function Consumer({ courseId }: { courseId: string | undefined }) {
  const { data } = useOrgCourseOrgBreakdown(courseId);
  return <div data-testid="result">{data ? `orgs:${data.orgs.length}` : 'none'}</div>;
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useOrgCourseOrgBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/org-course-org-breakdown with the courseId', async () => {
    mockCallApi.mockResolvedValue(breakdownResponse);

    renderWithClient(<Consumer courseId="course-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('orgs:2');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/org-course-org-breakdown', {
      courseId: 'course-1',
    });
  });

  it('does not fetch when courseId is undefined (dialog closed)', async () => {
    mockCallApi.mockResolvedValue(breakdownResponse);

    renderWithClient(<Consumer courseId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('different courseId params produce different cache entries', async () => {
    mockCallApi
      .mockResolvedValueOnce({ orgs: [breakdownResponse.orgs[0]] })
      .mockResolvedValueOnce({ orgs: breakdownResponse.orgs });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TwoConsumers() {
      const { data: data1 } = useOrgCourseOrgBreakdown('course-1');
      const { data: data2 } = useOrgCourseOrgBreakdown('course-2');
      return (
        <>
          <div data-testid="c1">{data1 ? `o:${data1.orgs.length}` : 'none'}</div>
          <div data-testid="c2">{data2 ? `o:${data2.orgs.length}` : 'none'}</div>
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <TwoConsumers />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('c1')).toHaveTextContent('o:1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('c2')).toHaveTextContent('o:2');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(2);
    expect(mockCallApi).toHaveBeenNthCalledWith(1, '/api/org-course-org-breakdown', { courseId: 'course-1' });
    expect(mockCallApi).toHaveBeenNthCalledWith(2, '/api/org-course-org-breakdown', { courseId: 'course-2' });
  });
});
