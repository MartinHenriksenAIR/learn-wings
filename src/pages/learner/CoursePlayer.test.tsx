import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// AppLayout → passthrough (skips breadcrumbs/i18n)
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// PdfViewer → stub (avoids pulling in the pdf.js worker at import time)
vi.mock('@/components/learner/PdfViewer', () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

// api-client + storage → no network. Wrapping a `mock`-prefixed vi.fn() in the factory
// keeps callApi's generic return type satisfied for tsc (matches CoursesManager.test.tsx).
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));
vi.mock('@/lib/storage', () => ({ getSignedAssetUrl: vi.fn() }));

// toast → no-op
vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

// useAuth + usePlatformSettings → factory mocks (names MUST be `mock`-prefixed for hoisting)
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
}));

import CoursePlayer from './CoursePlayer';

const baseAuth = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false },
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
  isLoading: false,
};

function makeModules(lessonCount: number) {
  return [
    {
      id: 'm-1',
      title: 'Module 1',
      sort_order: 0,
      lessons: Array.from({ length: lessonCount }, (_, i) => ({
        id: `l-${i + 1}`,
        title: `Lesson ${i + 1}`,
        lesson_type: 'video',
        module_id: 'm-1',
        sort_order: i,
      })),
    },
  ];
}

function makeProgress(completedIds: string[]) {
  const map: Record<string, { status: string; completed_at: string }> = {};
  completedIds.forEach((id) => {
    map[id] = { status: 'completed', completed_at: '2026-06-12T00:00:00Z' };
  });
  return map;
}

// Configure the player payload + feature flag for a single test.
function setup(opts: {
  reviewsEnabled: boolean;
  completed: string[];
  review?: { id: string; rating: number; comment: string } | null;
}) {
  mockUseAuth.mockReturnValue(baseAuth);
  mockUsePlatformSettings.mockReturnValue({
    features: {
      certificates_enabled: false,
      quizzes_enabled: true,
      analytics_enabled: true,
      course_reviews_enabled: opts.reviewsEnabled,
      community_enabled: true,
    },
  });
  mockCallApi.mockImplementation(async (url: string) => {
    if (url === '/api/course-player-data') {
      return Promise.resolve({
        course: { id: 'c-1', title: 'Intro to AI', is_published: true },
        modules: makeModules(5),
        progressMap: makeProgress(opts.completed),
        review: opts.review ?? null,
      });
    }
    if (url === '/api/quiz-by-lesson') {
      return Promise.resolve({ quiz: null, questions: [] });
    }
    return Promise.resolve({});
  });
}

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={['/app/courses/c-1']}>
      <Routes>
        <Route path="/app/courses/:courseId" element={<CoursePlayer />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CoursePlayer — review entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the review button below 20% progress', async () => {
    setup({ reviewsEnabled: true, completed: [] }); // 0/5 = 0%
    renderPlayer();
    await screen.findByText('Intro to AI'); // wait for load
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit your review/i })).toBeNull();
  });

  it('hides the review button when course reviews are disabled, even at >=20%', async () => {
    setup({ reviewsEnabled: false, completed: ['l-1'] }); // 1/5 = 20%
    renderPlayer();
    await screen.findByText('Intro to AI');
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
  });

  it('shows "Rate this course" at >=20% with reviews enabled and no existing review', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null }); // 20%
    renderPlayer();
    expect(await screen.findByRole('button', { name: /rate this course/i })).toBeInTheDocument();
  });

  it('shows "Edit your review" when an existing review is present', async () => {
    setup({
      reviewsEnabled: true,
      completed: ['l-1'],
      review: { id: 'r-1', rating: 4, comment: 'Nice' },
    });
    renderPlayer();
    expect(await screen.findByRole('button', { name: /edit your review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rate this course/i })).toBeNull();
  });

  it('opens CourseReviewDialog when the button is clicked', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null });
    renderPlayer();
    const button = await screen.findByRole('button', { name: /rate this course/i });
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rate This Course')).toBeInTheDocument();
  });
});
