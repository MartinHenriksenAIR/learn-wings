import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'da' } }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client and storage so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn().mockResolvedValue(null),
}));

// --- mock sonner toast ---
vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

// --- useAuth mock factory ---
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

    // Spinner must NOT be present (loading resolved because profile is non-null)
    expect(document.querySelector('.animate-spin')).toBeNull();

    // No-org branch text
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
  });

  it('keeps spinner when user exists but profile not yet resolved (keep-waiting case)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: null, currentOrg: null });

    renderCourses();

    // Profile is null and currentOrg is null — guard must keep spinner
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    // ...and must NOT fire the org-scoped fetch while the context is unresolved
    expect(callApi).not.toHaveBeenCalled();
  });

  it('fetches and resolves the spinner once the profile and org resolve (keep-waiting → ready)', async () => {
    vi.mocked(callApi).mockResolvedValue({ courses: [], enrollments: [] });

    const qc = makeClient();

    // Initial render: context unresolved → spinner, no fetch
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

    // Context resolves with an org → fetch fires and the spinner clears
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
    // Chip appears on the recommended card
    expect(screen.getByTestId('recommended-chip')).toBeInTheDocument();
    // The "All courses" heading also renders
    expect(screen.getByText('assessment.recommendations.allCourses')).toBeInTheDocument();
    // Both courses still appear in the full catalog below
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

    // Wait for courses to load
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
});
