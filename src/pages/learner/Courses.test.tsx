import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'da' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

import LearnerCourses from './Courses';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';

const baseAuthState = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' },
  memberships: [],
  currentOrg: null,
  isPlatformAdmin: false,
  isOrgAdmin: false,
  isLoading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshUserContext: vi.fn(),
  setCurrentOrg: vi.fn(),
  viewMode: 'learner' as const,
  setViewMode: vi.fn(),
  effectiveIsPlatformAdmin: false,
  effectiveIsOrgAdmin: false,
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderCourses(client?: QueryClient) {
  const qc = client ?? makeClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LearnerCourses />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LearnerCourses — profile-gated loading guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT render the spinner when user is null (unauthenticated)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: null, profile: null });

    renderCourses();

    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('resolves loading and shows no-org state when user has profile but no org', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: baseAuthState.profile, currentOrg: null });

    renderCourses();

    expect(document.querySelector('.animate-spin')).toBeNull();

    // No-org branch text
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
  });

  it('keeps spinner when user exists but profile not yet resolved (keep-waiting case)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: null, currentOrg: null });

    renderCourses();

    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('fetches and resolves the spinner once the profile and org resolve (keep-waiting → ready)', async () => {
    vi.mocked(callApi).mockResolvedValue({ courses: [], enrollments: [] });

    const qc = makeClient();

    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: null, currentOrg: null });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LearnerCourses />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(callApi).not.toHaveBeenCalled();

    const currentOrg = { id: 'org-1', name: 'Org One' };
    mockUseAuth.mockReturnValue({ ...baseAuthState, profile: baseAuthState.profile, currentOrg });
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <LearnerCourses />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith('/api/learner-courses', {
        orgId: 'org-1',
        language: 'da',
      });
    });
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeNull();
    });
  });
});

describe('LearnerCourses — enroll in-button morph (no success toast)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };
  const course = {
    id: 'c-1',
    title: 'Intro to AI',
    description: 'Learn the basics',
    level: 'basic',
    is_published: true,
    thumbnail_url: null,
    created_by_user_id: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg });
  });

  it('morphs Enroll → "Enrolled" → Continue, with no success toast', async () => {
    // Fake timers so the 1.6s flash window is fast-forwarded instead of waited out.
    // shouldAdvanceTime keeps waitFor/findBy polling alive under vitest fake timers.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let enrolled = false;
      vi.mocked(callApi).mockImplementation(async (url: unknown) => {
        if (url === '/api/learner-courses') {
          return {
            courses: [course],
            enrollments: enrolled
              ? [{ id: 'e-1', course_id: 'c-1', status: 'enrolled' }]
              : [],
          };
        }
        if (url === '/api/enroll') {
          enrolled = true;
          return {};
        }
        return {};
      });

      renderCourses();
      fireEvent.click(await screen.findByRole('button', { name: 'common.enroll' }));

      // In-button success morph appears...
      expect(await screen.findByRole('button', { name: /common\.enrolled/ })).toBeInTheDocument();
      // ...without a success toast
      expect(toast).not.toHaveBeenCalled();

      // After the flash expires, the card settles on the normal Continue state
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /common\.continue/ })).toBeInTheDocument()
      );
      expect(screen.queryByRole('button', { name: /common\.enrolled/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the destructive toast on enroll failure and does not morph', async () => {
    vi.mocked(callApi).mockImplementation(async (url: unknown) => {
      if (url === '/api/learner-courses') return { courses: [course], enrollments: [] };
      if (url === '/api/enroll') throw new Error('boom');
      return {};
    });

    renderCourses();
    fireEvent.click(await screen.findByRole('button', { name: 'common.enroll' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'courses.enrollmentFailed',
        variant: 'destructive',
      }));
    });
    expect(screen.queryByRole('button', { name: /common\.enrolled/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'common.enroll' })).toBeInTheDocument();
  });
});

describe('LearnerCourses — failed fetch shows error fork, not empty state', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg });
  });

  it('renders the retryable error state (not "no courses available") when the catalogue fetch fails', async () => {
    vi.mocked(callApi).mockRejectedValue(new Error('boom'));

    renderCourses();

    expect(await screen.findByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
    // The success-empty state must NOT be shown on a failure.
    expect(screen.queryByText('courses.noCoursesAvailable')).toBeNull();
  });
});

describe('LearnerCourses — recommended section', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

  const basicCourse = {
    id: 'c-basic', title: 'Basic AI Course', description: 'Intro level',
    level: 'basic', is_published: true, thumbnail_url: null,
    created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };
  const advancedCourse = {
    id: 'c-advanced', title: 'Advanced AI Course', description: 'Expert level',
    level: 'advanced', is_published: true, thumbnail_url: null,
    created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callApi).mockResolvedValue({
      courses: [basicCourse, advancedCourse],
      enrollments: [],
    });
  });

  it('renders the recommended section and chip when profile has an assessment level matching some courses', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'basic' },
    });

    renderCourses();

    expect(await screen.findByTestId('recommended-section')).toBeInTheDocument();
    expect(screen.getByText('assessment.recommendations.forYou')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-chip')).toBeInTheDocument();
    expect(screen.getByText('assessment.recommendations.allCourses')).toBeInTheDocument();
    expect(screen.getAllByText('Basic AI Course').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Advanced AI Course')).toBeInTheDocument();
  });

  it('does NOT render the recommended section when assessment_level is null', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });

    renderCourses();

    await screen.findByText('Basic AI Course');
    expect(screen.queryByTestId('recommended-section')).toBeNull();
    expect(screen.queryByText('assessment.recommendations.forYou')).toBeNull();
  });

  it('does NOT render the recommended section when no courses match the level', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'intermediate' },
    });

    renderCourses();

    await screen.findByText('Basic AI Course');
    expect(screen.queryByTestId('recommended-section')).toBeNull();
  });

  it('shows both the chip and the enrolled badge on a recommended card for an enrolled course', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [basicCourse, advancedCourse],
      enrollments: [{ id: 'e-1', course_id: 'c-basic', status: 'enrolled' }],
    });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'basic' },
    });

    renderCourses();

    expect(await screen.findByTestId('recommended-section')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-chip')).toBeInTheDocument();
    const enrolledBadges = screen.getAllByTestId('status-badge-enrolled');
    expect(enrolledBadges.length).toBeGreaterThanOrEqual(1);
    expect(enrolledBadges[0]).toHaveClass('left-3');
  });
});

describe('LearnerCourses — enrolled-first ordering of the "All courses" grid (#338)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

  // Backend returns courses ORDER BY c.title (alphabetical); mirror that here.
  const apple = {
    id: 'c-apple', title: 'Apple', description: 'a course', level: 'basic',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };
  const banana = {
    id: 'c-banana', title: 'Banana', description: 'b course', level: 'basic',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };
  const cherry = {
    id: 'c-cherry', title: 'Cherry', description: 'c course', level: 'basic',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };
  const date = {
    id: 'c-date', title: 'Date', description: 'd course', level: 'advanced',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };

  // banana = enrolled (older), cherry = completed (newer) — both count as "enrolled".
  const enrollments = [
    { id: 'e-banana', course_id: 'c-banana', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null },
    { id: 'e-cherry', course_id: 'c-cherry', status: 'completed', enrolled_at: '2026-01-20T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' },
  ];

  const titleOrder = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    // assessment_level null → no "Recommended for you" section, so h3 course titles
    // appear exactly once (only in the "All courses" grid) and order is unambiguous.
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });
  });

  it('sorts enrolled (enrolled OR completed) courses first, by enrolled_at DESC, non-enrolled after in alphabetical order', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [apple, banana, cherry, date],
      enrollments,
    });

    renderCourses();

    await screen.findByText('Apple');
    // Enrolled first by enrolled_at DESC (Cherry 01-20, Banana 01-10),
    // then non-enrolled preserving the backend's alphabetical order (Apple, Date).
    expect(titleOrder()).toEqual(['Cherry', 'Banana', 'Apple', 'Date']);
  });

  it('keeps non-enrolled courses in their incoming alphabetical order when nothing is enrolled', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [apple, banana, cherry, date],
      enrollments: [],
    });

    renderCourses();

    await screen.findByText('Apple');
    expect(titleOrder()).toEqual(['Apple', 'Banana', 'Cherry', 'Date']);
  });

  it('applies the enrolled-first sort after the level filter narrows the grid', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [apple, banana, cherry, date],
      enrollments,
    });

    renderCourses();

    await screen.findByText('Apple');
    // Narrow to 'basic' — excludes Date (advanced); Apple/Banana/Cherry remain.
    fireEvent.change(screen.getByLabelText('courses.level'), { target: { value: 'basic' } });

    // Enrolled first (Cherry, Banana), then non-enrolled (Apple); Date filtered out.
    expect(titleOrder()).toEqual(['Cherry', 'Banana', 'Apple']);
  });
});

describe('LearnerCourses — progress bar + % on enrolled cards (#340)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

  const course = {
    id: 'c-1', title: 'Intro to AI', description: 'Learn the basics', level: 'basic',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });
  });

  it('renders a progress bar with the rounded percentage on an in-progress enrolled card', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [{ id: 'e-1', course_id: 'c-1', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null }],
      progress: { 'c-1': { total: 3, completed: 2 } }, // 2/3 → 67%
    });

    renderCourses();

    const bar = await screen.findByTestId('course-progress-c-1');
    expect(bar).toBeInTheDocument();
    // 2/3 rounds to 67%
    expect(screen.getByText('67%')).toBeInTheDocument();
    const fill = bar.querySelector('.bg-primary') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill!.style.width).toBe('67%');
  });

  it('reads 100% on a completed card regardless of the raw counts', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [{ id: 'e-1', course_id: 'c-1', status: 'completed', enrolled_at: '2026-01-10T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' }],
      progress: { 'c-1': { total: 5, completed: 2 } }, // completed status overrides → 100%
    });

    renderCourses();

    expect(await screen.findByTestId('course-progress-c-1')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders no progress bar on a not-enrolled card', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [],
      progress: {},
    });

    renderCourses();

    // The Enroll CTA is present, but no progress bar is rendered.
    expect(await screen.findByRole('button', { name: 'common.enroll' })).toBeInTheDocument();
    expect(screen.queryByTestId('course-progress-c-1')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('shows 0% (no NaN) when an enrolled course has no lessons (total 0)', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [{ id: 'e-1', course_id: 'c-1', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null }],
      progress: { 'c-1': { total: 0, completed: 0 } },
    });

    renderCourses();

    expect(await screen.findByTestId('course-progress-c-1')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).toBeNull();
  });
});
