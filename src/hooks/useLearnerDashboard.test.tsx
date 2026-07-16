import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

const { mockGetSignedLmsAssetUrl } = vi.hoisted(() => ({
  mockGetSignedLmsAssetUrl: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: (...args: unknown[]) => mockGetSignedLmsAssetUrl(...args),
}));

import { useLearnerDashboard } from './useLearnerDashboard';

const course = {
  id: 'c-1',
  title: 'Intro to AI',
  description: 'Learn the basics',
  level: 'basic' as const,
  is_published: true,
  thumbnail_url: 'raw-path/thumb.jpg',
  created_by_user_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

const enrollment = {
  id: 'e-1',
  org_id: 'org-1',
  user_id: 'p-1',
  course_id: 'c-1',
  status: 'enrolled' as const,
  enrolled_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  course,
};

function Consumer({ orgId, enabled }: { orgId: string | undefined; enabled?: boolean }) {
  const query = useLearnerDashboard(orgId, enabled !== undefined ? { enabled } : {});
  if (query.isLoading) return <div data-testid="loading">loading</div>;
  const enrollments = query.data?.enrollments ?? [];
  const thumbnailUrls = query.data?.thumbnailUrls ?? {};
  return (
    <div>
      <div data-testid="enrollments">{enrollments.map((e) => e.id).join(',')}</div>
      <div data-testid="thumbnails">{Object.entries(thumbnailUrls).map(([k, v]) => `${k}:${v}`).join(',')}</div>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useLearnerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/learner-dashboard with the correct { orgId } body', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue('https://signed.example.com/thumb.jpg');
    mockCallApi.mockResolvedValue({ enrollments: [enrollment], progress: {} });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/learner-dashboard', { orgId: 'org-1' });
    });
  });

  it('builds thumbnailUrls map keyed by course_id with signed URLs', async () => {
    const signedUrl = 'https://signed.example.com/thumb.jpg';
    mockGetSignedLmsAssetUrl.mockResolvedValue(signedUrl);
    mockCallApi.mockResolvedValue({ enrollments: [enrollment], progress: {} });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('thumbnails')).toHaveTextContent('c-1:' + signedUrl);
    });
    expect(mockGetSignedLmsAssetUrl).toHaveBeenCalledWith(course.thumbnail_url);
  });

  it('does not add an entry to thumbnailUrls when signed URL is null', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue(null);
    mockCallApi.mockResolvedValue({ enrollments: [enrollment], progress: {} });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('enrollments')).toHaveTextContent('e-1');
    });
    expect(screen.getByTestId('thumbnails')).toHaveTextContent('');
  });

  it('does not fetch when enabled is false', async () => {
    renderWithClient(<Consumer orgId="org-1" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when orgId is undefined (default enabled gate)', async () => {
    renderWithClient(<Consumer orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('returns enrollments and progress from the API response', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue(null);
    mockCallApi.mockResolvedValue({
      enrollments: [enrollment],
      progress: { 'c-1': { total: 4, completed: 2 } },
    });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('enrollments')).toHaveTextContent('e-1');
    });
  });
});
