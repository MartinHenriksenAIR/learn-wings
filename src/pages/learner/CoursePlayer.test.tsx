import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// react-i18next → key-returning t (the player uses t() for the completion-failure toast)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

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

// toast → assertable spy
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

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
    expect(screen.queryByRole('button', { name: /rateThisCourse/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /editYourReview/i })).toBeNull();
  });

  it('hides the review button when course reviews are disabled, even at >=20%', async () => {
    setup({ reviewsEnabled: false, completed: ['l-1'] }); // 1/5 = 20%
    renderPlayer();
    await screen.findByText('Intro to AI');
    expect(screen.queryByRole('button', { name: /rateThisCourse/i })).toBeNull();
  });

  it('shows "Rate this course" at >=20% with reviews enabled and no existing review', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null }); // 20%
    renderPlayer();
    expect(await screen.findByRole('button', { name: /rateThisCourse/i })).toBeInTheDocument();
  });

  it('shows "Edit your review" when an existing review is present', async () => {
    setup({
      reviewsEnabled: true,
      completed: ['l-1'],
      review: { id: 'r-1', rating: 4, comment: 'Nice' },
    });
    renderPlayer();
    expect(await screen.findByRole('button', { name: /editYourReview/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rateThisCourse/i })).toBeNull();
  });

  it('opens CourseReviewDialog when the button is clicked', async () => {
    setup({ reviewsEnabled: true, completed: ['l-1'], review: null });
    renderPlayer();
    const button = await screen.findByRole('button', { name: /rateThisCourse/i });
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rate This Course')).toBeInTheDocument();
  });
});

describe('CoursePlayer — restyled sidebar and footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sidebar progress label counts only this course's lessons (n/m · pct%)", async () => {
    // 1 completed lesson of THIS course + 2 foreign rows — the label must read 1/5 · 20%
    setup({ reviewsEnabled: false, completed: ['l-1', 'other-1', 'other-2'] });
    renderPlayer();
    await screen.findByText('Intro to AI');
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '1/5 · 20%')
    ).toBeInTheDocument();
  });

  it('shows the pop-in Completed badge instead of the complete button on a completed lesson', async () => {
    setup({ reviewsEnabled: false, completed: ['l-1'] }); // initial lesson l-1 is completed
    renderPlayer();
    await screen.findByText('Intro to AI');

    const badge = screen.getByText('coursePlayer.completed');
    expect(badge).toHaveClass('animate-pop-in');
    expect(screen.queryByRole('button', { name: /markAsComplete/i })).toBeNull();

    // Footer nav: Previous disabled on the first lesson, Next enabled
    expect(screen.getByRole('button', { name: /common\.previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /common\.next/ })).toBeEnabled();
  });
});

describe('CoursePlayer — completion semantics (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(baseAuth);
    mockUsePlatformSettings.mockReturnValue({
      features: {
        certificates_enabled: false,
        quizzes_enabled: true,
        analytics_enabled: true,
        course_reviews_enabled: false,
        community_enabled: true,
      },
    });
  });

  // Two-lesson course; progressMap is configurable so tests can inject prior
  // progress (including rows from OTHER courses — course-player-data returns the
  // user's progress for the whole org, not just this course).
  function setupCompletion(opts: {
    progressMap?: Record<string, { status: string; completed_at: string }>;
    enrollmentCompleteError?: Error;
  }) {
    mockCallApi.mockImplementation(async (url: string) => {
      if (url === '/api/course-player-data') {
        return {
          course: { id: 'c-1', title: 'Intro to AI', is_published: true },
          modules: makeModules(2),
          progressMap: opts.progressMap ?? {},
          review: null,
        };
      }
      if (url === '/api/quiz-by-lesson') return { quiz: null, questions: [] };
      if (url === '/api/enrollment-complete' && opts.enrollmentCompleteError) {
        throw opts.enrollmentCompleteError;
      }
      return {};
    });
  }

  it('does NOT mark the course complete from progress rows that belong to other courses', async () => {
    // 3 completed lessons from OTHER courses in the org — more rows than this
    // course's 2 lessons. Completing lesson 1 of 2 must NOT complete the course.
    setupCompletion({
      progressMap: makeProgress(['other-1', 'other-2', 'other-3']),
    });
    renderPlayer();

    const btn = await screen.findByRole('button', { name: /markAsComplete/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/lesson-progress', {
        orgId: 'org-1', lessonId: 'l-1', status: 'completed',
      });
    });

    // No premature completion: no enrollment-complete call, no congratulations dialog
    expect(mockCallApi).not.toHaveBeenCalledWith('/api/enrollment-complete', expect.anything());
    expect(screen.queryByText(/congratulations/i)).toBeNull();
  });

  it('records the enrollment as completed and shows the congratulations dialog on the last lesson', async () => {
    setupCompletion({ progressMap: makeProgress(['l-1']) });
    renderPlayer();

    await screen.findByText('Intro to AI');
    // Select the last incomplete lesson and complete it
    fireEvent.click(screen.getByRole('button', { name: /lesson 2/i }));
    fireEvent.click(await screen.findByRole('button', { name: /markAsComplete/i }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/enrollment-complete', {
        orgId: 'org-1', courseId: 'c-1',
      });
    });
    expect(await screen.findByText(/congratulations/i)).toBeInTheDocument();
  });

  it('surfaces a failed completion call instead of celebrating (no silent "Continue forever")', async () => {
    setupCompletion({
      progressMap: makeProgress(['l-1']),
      enrollmentCompleteError: new Error('boom'),
    });
    renderPlayer();

    await screen.findByText('Intro to AI');
    fireEvent.click(screen.getByRole('button', { name: /lesson 2/i }));
    fireEvent.click(await screen.findByRole('button', { name: /markAsComplete/i }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/enrollment-complete', {
        orgId: 'org-1', courseId: 'c-1',
      });
    });

    // The failure is surfaced and the congratulations dialog is withheld
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'coursePlayer.completionSaveFailed',
        variant: 'destructive',
      }));
    });
    expect(screen.queryByText(/congratulations/i)).toBeNull();
  });
});
