import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// react-i18next → key-returning t (the player uses t() for the completion-failure toast)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

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

  it('shows the Completed badge WITHOUT the pop-in animation on a lesson completed before load', async () => {
    setup({ reviewsEnabled: false, completed: ['l-1'] }); // initial lesson l-1 is completed
    renderPlayer();
    await screen.findByText('Intro to AI');

    const badge = screen.getByText('coursePlayer.completed');
    expect(badge).toBeInTheDocument();
    // Already-completed-on-load lessons must NOT replay the celebration on mount —
    // neither the footer badge nor the sidebar status dot.
    expect(badge).not.toHaveClass('animate-pop-in');
    expect(document.querySelector('.animate-pop-in')).toBeNull();
    expect(screen.queryByRole('button', { name: /markAsComplete/i })).toBeNull();

    // Footer nav: Previous disabled on the first lesson, Next enabled
    expect(screen.getByRole('button', { name: /common\.previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /common\.next/ })).toBeEnabled();
  });

  it('pops in the celebration only for the lesson completed during this session', async () => {
    setup({ reviewsEnabled: false, completed: ['l-2'] }); // l-2 pre-completed, l-1 not
    renderPlayer();
    await screen.findByText('Intro to AI');

    fireEvent.click(screen.getByRole('button', { name: /markAsComplete/i }));

    // The just-completed l-1 sidebar dot animates...
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /lesson 1/i }).querySelector('.animate-pop-in')
      ).not.toBeNull();
    });
    // ...while the pre-completed l-2 dot still does not
    expect(
      screen.getByRole('button', { name: /lesson 2/i }).querySelector('.animate-pop-in')
    ).toBeNull();

    // Auto-advanced onto pre-completed l-2: its footer badge renders without the animation
    expect(screen.getByText('coursePlayer.completed')).not.toHaveClass('animate-pop-in');

    // Navigating back to the just-completed lesson shows the animated footer badge
    fireEvent.click(screen.getByRole('button', { name: /lesson 1/i }));
    expect(await screen.findByText('coursePlayer.completed')).toHaveClass('animate-pop-in');
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
    lessonProgressError?: Error;
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
      if (url === '/api/lesson-progress' && opts.lessonProgressError) {
        throw opts.lessonProgressError;
      }
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

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'coursePlayer.completionSaveFailed',
        variant: 'destructive',
      }));
    });
    expect(screen.queryByText(/congratulations/i)).toBeNull();
  });

  it('surfaces a failed lesson-progress save and does not advance progress optimistically (#289)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupCompletion({ lessonProgressError: new Error('boom') });
    renderPlayer();

    await screen.findByText('Intro to AI');
    fireEvent.click(await screen.findByRole('button', { name: /markAsComplete/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'coursePlayer.progressSaveFailed',
        description: 'coursePlayer.progressSaveFailedDescription',
        variant: 'destructive',
      }));
    });

    // Nothing optimistic survives the failure: the sidebar counter stays at 0/2,
    // the lesson keeps its Mark-as-complete affordance, and no celebration plays.
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '0/2 · 0%')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /markAsComplete/i })).toBeInTheDocument();
    expect(screen.queryByText('coursePlayer.completed')).toBeNull();
    expect(document.querySelector('.animate-pop-in')).toBeNull();
    expect(mockCallApi).not.toHaveBeenCalledWith('/api/enrollment-complete', expect.anything());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('CoursePlayer — quiz load failure (#294)', () => {
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

  const quizPayload = {
    quiz: { id: 'q-1', lesson_id: 'l-1', title: 'Quiz 1', passing_score: 70 },
    questions: [
      {
        id: 'qq-1',
        question_text: 'What is 2 + 2?',
        sort_order: 0,
        options: [
          { id: 'o-1', option_text: '4' },
          { id: 'o-2', option_text: '5' },
        ],
      },
    ],
  };

  // Lesson 1 is the quiz (the initially selected lesson); lesson 2 defaults to a plain
  // video so a test can navigate away, and becomes a second quiz for the interleaving test.
  function courseData(secondLessonType: 'video' | 'quiz' = 'video') {
    return {
      course: { id: 'c-1', title: 'Intro to AI', is_published: true },
      modules: [
        {
          id: 'm-1',
          title: 'Module 1',
          sort_order: 0,
          lessons: [
            { id: 'l-1', title: 'Lesson 1', lesson_type: 'quiz', module_id: 'm-1', sort_order: 0 },
            { id: 'l-2', title: 'Lesson 2', lesson_type: secondLessonType, module_id: 'm-1', sort_order: 1 },
          ],
        },
      ],
      progressMap: {},
      review: null,
    };
  }

  // `quizResults` is consumed one entry per quiz-by-lesson call — the last entry sticks —
  // which is how the retry path gets a different outcome.
  function setupQuizLesson(quizResults: Array<'fail' | 'empty' | 'ok'>) {
    let call = 0;
    mockCallApi.mockImplementation(async (url: string) => {
      if (url === '/api/course-player-data') return courseData();
      if (url === '/api/quiz-by-lesson') {
        const result = quizResults[Math.min(call, quizResults.length - 1)];
        call += 1;
        if (result === 'fail') throw new Error('boom');
        if (result === 'empty') return { quiz: null, questions: [] };
        return quizPayload;
      }
      return {};
    });
  }

  // Each quiz-by-lesson call parks on its own deferred so a test can settle the requests
  // out of order — the only way to reproduce two loads overlapping in flight.
  function setupDeferredQuizLoads(secondLessonType: 'video' | 'quiz' = 'video') {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
    mockCallApi.mockImplementation(async (url: string) => {
      if (url === '/api/course-player-data') return courseData(secondLessonType);
      if (url === '/api/quiz-by-lesson') {
        return new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
      }
      return {};
    });
    return pending;
  }

  function quizCallCount() {
    return mockCallApi.mock.calls.filter((args) => args[0] === '/api/quiz-by-lesson').length;
  }

  it('renders the error card with a retry instead of an empty pane when the quiz load fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupQuizLesson(['fail']);
    renderPlayer();

    // The shared QueryErrorState: announced to screen readers and visually distinct
    // from the "nothing uploaded" empty states, with the app-wide retry label.
    const card = await screen.findByRole('alert');
    expect(within(card).getByText('coursePlayer.quizLoadFailed')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /common\.retry/i })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('re-issues the request on retry and renders the quiz once it succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupQuizLesson(['fail', 'ok']);
    renderPlayer();

    fireEvent.click(await screen.findByRole('button', { name: /common\.retry/i }));

    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument();
    expect(quizCallCount()).toBe(2);
    expect(screen.queryByText('coursePlayer.quizLoadFailed')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    consoleError.mockRestore();
  });

  it('shows the loading spinner while the quiz request is in flight, then swaps it for the quiz', async () => {
    const pending = setupDeferredQuizLoads();
    renderPlayer();

    expect(await screen.findByText('coursePlayer.loadingQuiz')).toBeInTheDocument();
    expect(screen.queryByText(/What is 2 \+ 2\?/)).toBeNull();

    pending[0].resolve(quizPayload);

    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument();
    expect(screen.queryByText('coursePlayer.loadingQuiz')).toBeNull();
  });

  it('ignores a stale failed load that lands after the learner switched to a quiz that loads fine', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = setupDeferredQuizLoads('quiz');
    renderPlayer();

    // Lesson 1's request is still in flight when the learner clicks lesson 2 — the
    // sidebar stays mounted and clickable during a quiz load.
    await screen.findByText('coursePlayer.loadingQuiz');
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /lesson 2/i }));
    await waitFor(() => expect(pending).toHaveLength(2));

    // The abandoned lesson-1 request fails first; lesson 2 then succeeds.
    pending[0].reject(new Error('boom'));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    pending[1].resolve(quizPayload);

    // The working quiz must not carry the dead lesson's error card on top of it.
    expect(await screen.findByText(/What is 2 \+ 2\?/)).toBeInTheDocument();
    expect(screen.queryByText('coursePlayer.quizLoadFailed')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    consoleError.mockRestore();
  });

  it('does NOT show the error card on a quiz lesson that legitimately has no quiz', async () => {
    setupQuizLesson(['empty']);
    renderPlayer();

    await screen.findByText('Intro to AI');
    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/quiz-by-lesson', { lessonId: 'l-1' });
    });
    await waitFor(() => {
      expect(screen.queryByText('coursePlayer.loadingQuiz')).toBeNull();
    });
    expect(screen.queryByText('coursePlayer.quizLoadFailed')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the error when the learner navigates to another lesson', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupQuizLesson(['fail']);
    renderPlayer();

    await screen.findByText('coursePlayer.quizLoadFailed');
    fireEvent.click(screen.getByRole('button', { name: /lesson 2/i }));

    await waitFor(() => {
      expect(screen.queryByText('coursePlayer.quizLoadFailed')).toBeNull();
    });
    consoleError.mockRestore();
  });
});
