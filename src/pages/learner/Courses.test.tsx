import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'da', resolvedLanguage: 'da' } }),
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

vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseFavorites = vi.fn();
const mockUseToggleFavorite = vi.fn();
vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: (...args: unknown[]) => mockUseFavorites(...args),
  useToggleFavorite: (...args: unknown[]) => mockUseToggleFavorite(...args),
}));

const mockUseCourseCategories = vi.fn();
vi.mock('@/hooks/useCourseCategories', () => ({
  useCourseCategories: (...args: unknown[]) => mockUseCourseCategories(...args),
}));

import LearnerCourses from './Courses';
import { callApi } from '@/lib/api-client';

mockUseFavorites.mockReturnValue({ isFavorite: () => false, favoriteIds: new Set(), data: { courses: [] } });
mockUseToggleFavorite.mockReturnValue({ toggleFavorite: vi.fn(), togglingId: null, isPending: false });
mockUseCourseCategories.mockReturnValue({ data: [] });

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

  it('shows the invitation-only state for a non-admin with no org (blocked walk-in)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: baseAuthState.profile, currentOrg: null });

    renderCourses();

    expect(document.querySelector('.animate-spin')).toBeNull();

    expect(screen.getByText('dashboard.invitationOnlyTitle')).toBeInTheDocument();
    expect(screen.getByText('dashboard.invitationOnlyDescription')).toBeInTheDocument();
    expect(screen.queryByText('common.noOrgSelected')).toBeNull();
    expect(screen.queryByText('courses.joinOrgToAccessCourses')).toBeNull();
  });

  it('shows the generic no-org-selected state for a platform admin with no org', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, currentOrg: null, isPlatformAdmin: true });

    renderCourses();

    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
    expect(screen.getByText('courses.joinOrgToAccessCourses')).toBeInTheDocument();
    expect(screen.queryByText('dashboard.invitationOnlyTitle')).toBeNull();
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

describe('LearnerCourses — warm, org-name-free subtitle (#360)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callApi).mockResolvedValue({ courses: [], enrollments: [], progress: {} });
  });

  it('shows the single warm subtitle for an individual org (never an org name / the old individual key)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-solo', name: 'Individuals', kind: 'individual' },
    });

    renderCourses();

    expect(await screen.findByText('courses.subtitle')).toBeInTheDocument();
    expect(screen.queryByText('courses.subtitleIndividual')).toBeNull();
  });

  it('shows the same warm subtitle for a standard org (no org name interpolated)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg: { id: 'org-1', name: 'Org One', kind: 'standard' },
    });

    renderCourses();

    expect(await screen.findByText('courses.subtitle')).toBeInTheDocument();
    expect(screen.queryByText('courses.subtitleIndividual')).toBeNull();
  });
});

describe('LearnerCourses — single Start/Continue/Review CTA (implicit enrollment #357)', () => {
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

  it('a not-started course shows a "Start course" link to the player, and no enroll step happens', async () => {
    vi.mocked(callApi).mockResolvedValue({ courses: [course], enrollments: [], progress: {} });

    renderCourses();

    const start = await screen.findByRole('link', { name: /courses\.startCourse/ });
    expect(start).toHaveAttribute('href', '/app/learn/c-1');
    expect(screen.queryByRole('button', { name: /common\.enroll/ })).toBeNull();
    expect(vi.mocked(callApi).mock.calls.every(([url]) => url === '/api/learner-courses')).toBe(true);
  });

  it('a started (in-progress) course shows a Continue link to the player', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [{ id: 'e-1', course_id: 'c-1', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null }],
      progress: { 'c-1': { total: 4, completed: 1 } },
    });

    renderCourses();

    const cont = await screen.findByRole('link', { name: /common\.continue/ });
    expect(cont).toHaveAttribute('href', '/app/learn/c-1');
  });

  it('a completed course shows a "Review course" link to the player', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [{ id: 'e-1', course_id: 'c-1', status: 'completed', enrolled_at: '2026-01-10T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' }],
      progress: { 'c-1': { total: 4, completed: 4 } },
    });

    renderCourses();

    const review = await screen.findByRole('link', { name: /courses\.reviewCourse/ });
    expect(review).toHaveAttribute('href', '/app/learn/c-1');
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

  it('shows the chip and a Continue link (no "Enrolled" badge) on a recommended started course', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [basicCourse, advancedCourse],
      enrollments: [{ id: 'e-1', course_id: 'c-basic', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null }],
      progress: {},
    });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'basic' },
    });

    renderCourses();

    expect(await screen.findByTestId('recommended-section')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-chip')).toBeInTheDocument();
    const continueLinks = screen.getAllByRole('link', { name: /common\.continue/ });
    expect(continueLinks.length).toBeGreaterThanOrEqual(1);
    continueLinks.forEach((l) => expect(l).toHaveAttribute('href', '/app/learn/c-basic'));
    expect(screen.queryByTestId('status-badge-enrolled')).toBeNull();
  });

  it('hides the recommended section (and its "All courses" heading) once a filter is active (#360)', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'basic' },
    });

    renderCourses();

    expect(await screen.findByTestId('recommended-section')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'courses.levels.advanced' }));
    expect(screen.queryByTestId('recommended-section')).toBeNull();
    expect(screen.queryByText('assessment.recommendations.allCourses')).toBeNull();
  });
});

describe('LearnerCourses — enrolled-first ordering of the "All courses" grid (#338)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

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

  const enrollments = [
    { id: 'e-banana', course_id: 'c-banana', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null },
    { id: 'e-cherry', course_id: 'c-cherry', status: 'completed', enrolled_at: '2026-01-20T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' },
  ];

  const titleOrder = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  beforeEach(() => {
    vi.clearAllMocks();
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
    fireEvent.click(screen.getByRole('button', { name: 'courses.levels.basic' }));

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

  it('renders no progress bar on a not-started card', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [course],
      enrollments: [],
      progress: {},
    });

    renderCourses();

    expect(await screen.findByRole('link', { name: /courses\.startCourse/ })).toBeInTheDocument();
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

describe('LearnerCourses — recency ordering of the enrolled group (#339)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };

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

  const titleOrder = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });
  });

  it('orders enrolled courses by last_accessed_at DESC, independent of enrolled_at', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [apple, banana, cherry],
      enrollments: [
        { id: 'e-apple', course_id: 'c-apple', status: 'enrolled', enrolled_at: '2026-01-01T00:00:00Z', completed_at: null, last_accessed_at: '2026-03-01T00:00:00Z' },
        { id: 'e-banana', course_id: 'c-banana', status: 'enrolled', enrolled_at: '2026-01-02T00:00:00Z', completed_at: null, last_accessed_at: '2026-03-05T00:00:00Z' },
        { id: 'e-cherry', course_id: 'c-cherry', status: 'completed', enrolled_at: '2026-01-03T00:00:00Z', completed_at: '2026-02-01T00:00:00Z', last_accessed_at: '2026-03-03T00:00:00Z' },
      ],
    });

    renderCourses();

    await screen.findByText('Apple');
    expect(titleOrder()).toEqual(['Banana', 'Cherry', 'Apple']);
  });

  it('falls back to enrolled_at when last_accessed_at is null', async () => {
    vi.mocked(callApi).mockResolvedValue({
      courses: [apple, banana, cherry],
      enrollments: [
        { id: 'e-apple', course_id: 'c-apple', status: 'enrolled', enrolled_at: '2026-01-20T00:00:00Z', completed_at: null, last_accessed_at: null },
        { id: 'e-banana', course_id: 'c-banana', status: 'enrolled', enrolled_at: '2026-01-10T00:00:00Z', completed_at: null, last_accessed_at: '2026-02-01T00:00:00Z' },
        { id: 'e-cherry', course_id: 'c-cherry', status: 'completed', enrolled_at: '2026-01-30T00:00:00Z', completed_at: '2026-02-15T00:00:00Z', last_accessed_at: null },
      ],
    });

    renderCourses();

    await screen.findByText('Apple');
    expect(titleOrder()).toEqual(['Banana', 'Cherry', 'Apple']);
  });
});

describe('LearnerCourses — favorite heart toggle (#358)', () => {
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
    vi.mocked(callApi).mockResolvedValue({ courses: [course], enrollments: [], progress: {} });
  });

  it('renders the add-to-favorites heart on a not-favorited card and toggles it on when clicked', async () => {
    const toggleFavorite = vi.fn();
    mockUseFavorites.mockReturnValue({ isFavorite: () => false, favoriteIds: new Set(), data: { courses: [] } });
    mockUseToggleFavorite.mockReturnValue({ toggleFavorite, togglingId: null, isPending: false });

    renderCourses();

    const heart = await screen.findByRole('button', { name: 'courses.addToFavorites' });
    expect(heart.querySelector('.fill-current')).toBeNull();

    fireEvent.click(heart);
    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c-1', favorite: true }));
    expect(toggleFavorite.mock.calls[0][0].course).toMatchObject({ id: 'c-1' });
  });

  it('renders the remove-from-favorites heart (filled) on a favorited card and toggles it off', async () => {
    const toggleFavorite = vi.fn();
    mockUseFavorites.mockReturnValue({
      isFavorite: (id: string) => id === 'c-1',
      favoriteIds: new Set(['c-1']),
      data: { courses: [course] },
    });
    mockUseToggleFavorite.mockReturnValue({ toggleFavorite, togglingId: null, isPending: false });

    renderCourses();

    const heart = await screen.findByRole('button', { name: 'courses.removeFromFavorites' });
    expect(heart.querySelector('.fill-current')).not.toBeNull();

    fireEvent.click(heart);
    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c-1', favorite: false }));
  });

  it('disables the heart while a toggle for that course is in flight', async () => {
    mockUseFavorites.mockReturnValue({ isFavorite: () => false, favoriteIds: new Set(), data: { courses: [] } });
    mockUseToggleFavorite.mockReturnValue({ toggleFavorite: vi.fn(), togglingId: 'c-1', isPending: true });

    renderCourses();

    const heart = await screen.findByRole('button', { name: 'courses.addToFavorites' });
    expect(heart).toBeDisabled();
  });
});

describe('LearnerCourses — catalog refinements: category filter, view toggle, card → detail (#360)', () => {
  const currentOrg = { id: 'org-1', name: 'Org One' };
  const aiCourse = {
    id: 'c-ai', title: 'AI Course', description: 'about ai', level: 'basic', category_id: 'cat-ai',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };
  const dataCourse = {
    id: 'c-data', title: 'Data Course', description: 'about data', level: 'basic', category_id: 'cat-data',
    is_published: true, thumbnail_url: null, created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      currentOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });
    vi.mocked(callApi).mockResolvedValue({ courses: [aiCourse, dataCourse], enrollments: [], progress: {} });
    mockUseCourseCategories.mockReturnValue({
      data: [
        { id: 'cat-ai', name_en: 'AI', name_da: 'AI', slug: 'ai', sort_order: 1, created_at: '' },
        { id: 'cat-data', name_en: 'Data', name_da: 'Data', slug: 'data', sort_order: 2, created_at: '' },
      ],
    });
  });

  it('makes the whole card a link to the course detail page (Start still points at the player)', async () => {
    renderCourses();
    await screen.findByText('AI Course');

    const detailHrefs = screen.getAllByRole('link', { name: 'courses.readAbout' }).map((l) => l.getAttribute('href'));
    expect(detailHrefs).toContain('/app/courses/c-ai');
    expect(detailHrefs).toContain('/app/courses/c-data');

    screen.getAllByRole('link', { name: /courses\.startCourse/ }).forEach((s) =>
      expect(s.getAttribute('href')).toMatch(/^\/app\/learn\//));
  });

  it('filters the grid by the selected category', async () => {
    renderCourses();
    await screen.findByText('AI Course');

    fireEvent.click(screen.getByRole('button', { name: 'AI' }));

    expect(screen.getByText('AI Course')).toBeInTheDocument();
    expect(screen.queryByText('Data Course')).toBeNull();
  });

  it('only lists categories that have a course in the catalogue', async () => {
    mockUseCourseCategories.mockReturnValue({
      data: [
        { id: 'cat-ai', name_en: 'AI', name_da: 'AI', slug: 'ai', sort_order: 1, created_at: '' },
        { id: 'cat-empty', name_en: 'Empty', name_da: 'Tom', slug: 'empty', sort_order: 2, created_at: '' },
      ],
    });
    renderCourses();
    await screen.findByText('AI Course');

    expect(screen.getByRole('button', { name: 'AI' })).toBeInTheDocument();  // has a course
    expect(screen.queryByRole('button', { name: 'Tom' })).toBeNull();        // no course → omitted
  });

  it('defaults to list view and toggles to card, persisting the choice', async () => {
    renderCourses();
    await screen.findByText('AI Course');

    expect(screen.getByTestId('catalog-list')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid')).toBeNull();
    expect(screen.getByLabelText('courses.viewAsList')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByLabelText('courses.viewAsCards'));

    expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-list')).toBeNull();
    expect(window.localStorage.getItem('kursuskatalog-view')).toBe('card');
  });

  it('restores the persisted list view on mount', async () => {
    window.localStorage.setItem('kursuskatalog-view', 'list');
    renderCourses();
    await screen.findByText('AI Course');

    expect(screen.getByTestId('catalog-list')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid')).toBeNull();
  });

  it('restores the persisted card view on mount, overriding the list default', async () => {
    window.localStorage.setItem('kursuskatalog-view', 'card');
    renderCourses();
    await screen.findByText('AI Course');

    expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-list')).toBeNull();
  });

  it('list rows expose the detail-overlay link, the Start→player link, and the favorite toggle', async () => {
    window.localStorage.setItem('kursuskatalog-view', 'list');
    renderCourses();
    await screen.findByText('AI Course');

    expect(screen.getByTestId('catalog-list')).toBeInTheDocument();
    const detailHrefs = screen.getAllByRole('link', { name: 'courses.readAbout' }).map((l) => l.getAttribute('href'));
    expect(detailHrefs).toContain('/app/courses/c-ai');
    screen.getAllByRole('link', { name: /courses\.startCourse/ }).forEach((s) =>
      expect(s.getAttribute('href')).toMatch(/^\/app\/learn\//));
    expect(screen.getAllByRole('button', { name: 'courses.addToFavorites' }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the "no match" empty state (not the org empty state) when a non-search filter yields nothing', async () => {
    renderCourses();
    await screen.findByText('AI Course');

    fireEvent.click(screen.getByRole('button', { name: 'courses.statusOptions.completed' }));

    expect(screen.getByText('courses.noCoursesMatch')).toBeInTheDocument();
    expect(screen.queryByText('courses.noCoursesForOrg')).toBeNull();
  });
});
