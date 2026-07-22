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

// Fixed, settable resolvedLanguage so query-key / body assertions stay deterministic
// while still letting individual tests exercise a different resolved language.
const { mockResolvedLanguage } = vi.hoisted(() => ({ mockResolvedLanguage: { value: 'da' } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: mockResolvedLanguage.value } }),
}));

import { useLearnerCourses } from './useLearnerCourses';

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
};

function Consumer({ orgId, enabled }: { orgId: string | undefined; enabled?: boolean }) {
  const query = useLearnerCourses(orgId, enabled !== undefined ? { enabled } : {});
  if (query.isLoading) return <div data-testid="loading">loading</div>;
  const courses = query.data?.courses ?? [];
  const enrollments = query.data?.enrollments ?? [];
  return (
    <div>
      <div data-testid="courses">{courses.map((c) => c.thumbnail_url).join(',')}</div>
      <div data-testid="enrollments">{enrollments.map((e) => e.id).join(',')}</div>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useLearnerCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvedLanguage.value = 'da';
  });

  it('calls /api/learner-courses with the correct { orgId, language } body', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue('https://signed.example.com/thumb.jpg');
    mockCallApi.mockResolvedValue({ courses: [course], enrollments: [enrollment] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/learner-courses', {
        orgId: 'org-1',
        language: 'da',
      });
    });
  });

  it('sends the resolved language when it is en', async () => {
    mockResolvedLanguage.value = 'en';
    mockGetSignedLmsAssetUrl.mockResolvedValue('https://signed.example.com/thumb.jpg');
    mockCallApi.mockResolvedValue({ courses: [course], enrollments: [enrollment] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/learner-courses', {
        orgId: 'org-1',
        language: 'en',
      });
    });
  });

  it('signs thumbnail URLs in the returned courses', async () => {
    const signedUrl = 'https://signed.example.com/thumb.jpg';
    mockGetSignedLmsAssetUrl.mockResolvedValue(signedUrl);
    mockCallApi.mockResolvedValue({ courses: [course], enrollments: [] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('courses')).toHaveTextContent(signedUrl);
    });
    expect(mockGetSignedLmsAssetUrl).toHaveBeenCalledWith(course.thumbnail_url);
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

  it('returns courses and enrollments from the API response', async () => {
    mockGetSignedLmsAssetUrl.mockResolvedValue(null);
    mockCallApi.mockResolvedValue({ courses: [course], enrollments: [enrollment] });

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('enrollments')).toHaveTextContent('e-1');
    });
  });
});
