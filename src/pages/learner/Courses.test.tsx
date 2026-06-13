import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
  getSignedLmsAssetUrl: vi.fn(),
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

function renderCourses() {
  return render(
    <MemoryRouter>
      <LearnerCourses />
    </MemoryRouter>
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

    // Initial render: context unresolved → spinner, no fetch
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: baseAuthState.user, profile: null, currentOrg: null });
    const { rerender } = renderCourses();
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    expect(callApi).not.toHaveBeenCalled();

    // Context resolves with an org → fetch fires and the spinner clears
    const currentOrg = { id: 'org-1', name: 'Org One' };
    mockUseAuth.mockReturnValue({ ...baseAuthState, profile: baseAuthState.profile, currentOrg });
    rerender(
      <MemoryRouter>
        <LearnerCourses />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(callApi).toHaveBeenCalledWith('/api/learner-courses', { orgId: 'org-1' });
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
