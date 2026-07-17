import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useOrgCourseProgress } from './useOrgCourseProgress';

const progressResponse = {
  courses: [
    { id: 'c1', title: 'AI Basics', level: 'basic' as const, enrolled: 10, completed: 7 },
    { id: 'c2', title: 'AI Advanced', level: 'advanced' as const, enrolled: 5, completed: 2 },
  ],
};

function Consumer({ orgId }: { orgId: string | undefined }) {
  const { data } = useOrgCourseProgress(orgId);
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

describe('useOrgCourseProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/org-course-progress with the correct orgId body', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('courses:2');
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/org-course-progress', { orgId: 'org-1' });
  });

  it('does not fetch when orgId is undefined', async () => {
    mockCallApi.mockResolvedValue(progressResponse);

    renderWithClient(<Consumer orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('result')).toHaveTextContent('none');
  });
});
