import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

// Re-signing runs over each course's thumbnail path; the mock prefixes it so
// the test can assert the queryFn re-signs before the data lands in the cache.
vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn((url: string | null) => Promise.resolve(url ? `signed:${url}` : null)),
}));

import { useCoursesAdmin } from './useCoursesAdmin';

const adminResponse = {
  courses: [
    { id: 'c1', title: 'AI Basics', thumbnail_url: 'thumbs/c1.png' },
    { id: 'c2', title: 'AI Advanced', thumbnail_url: null },
  ],
  accessRecords: [{ org_id: 'o1', course_id: 'c1', access: 'enabled' }],
};

function Consumer({ enabled }: { enabled?: boolean }) {
  const { data } = useCoursesAdmin({ enabled });
  return (
    <div data-testid="result">
      {data
        ? `courses:${data.courses.length} thumb:${data.courses[0]?.thumbnail_url} access:${data.accessRecords.length}`
        : 'none'}
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useCoursesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches /api/courses-admin once and returns the { courses, accessRecords } shape with re-signed thumbnails', async () => {
    mockCallApi.mockResolvedValue(adminResponse);

    renderWithClient(<Consumer />);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent(
        'courses:2 thumb:signed:thumbs/c1.png access:1',
      );
    });

    expect(mockCallApi).toHaveBeenCalledTimes(1);
    expect(mockCallApi).toHaveBeenCalledWith('/api/courses-admin', {});
  });

  it('does not fetch when enabled is false', async () => {
    mockCallApi.mockResolvedValue(adminResponse);

    renderWithClient(<Consumer enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
    expect(screen.getByTestId('result')).toHaveTextContent('none');
  });
});
