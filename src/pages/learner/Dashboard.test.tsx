import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client and storage so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getSignedLmsAssetUrl: vi.fn().mockResolvedValue(null),
}));

// --- mock CertificateCard to avoid deep imports ---
vi.mock('@/components/learner/CertificateCard', () => ({
  CertificateCard: () => <div data-testid="cert-card" />,
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

// --- usePlatformSettings mock ---
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { certificates_enabled: false } }),
}));

import LearnerDashboard from './Dashboard';

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

function renderDashboard() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <LearnerDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LearnerDashboard — no-membership empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves loading and shows no-membership empty state when user has profile but no memberships', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, memberships: [], currentOrg: null });

    renderDashboard();

    // Spinner must NOT be present (loading resolved)
    expect(document.querySelector('.animate-spin')).toBeNull();

    // Empty-state title key must be rendered (t returns the key)
    expect(screen.getByText('dashboard.noMembershipTitle')).toBeInTheDocument();
    expect(screen.getByText('dashboard.noMembershipDescription')).toBeInTheDocument();
  });

  it('shows the platform-admin no-org-selected state when memberships exist but no org is selected', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'org_admin', status: 'active' }],
      currentOrg: null,
      isPlatformAdmin: true,
      effectiveIsPlatformAdmin: true,
    });

    renderDashboard();

    expect(document.querySelector('.animate-spin')).toBeNull();

    // Non-membership path uses common.noOrgSelected key
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
  });

  it('does NOT render the spinner when user is null (unauthenticated)', async () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: null, profile: null });

    renderDashboard();

    expect(document.querySelector('.animate-spin')).toBeNull();
  });
});

describe('LearnerDashboard — completion count (#18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts an enrollment with status completed in the Completed stat and section', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({
      enrollments: [
        {
          id: 'e-1', org_id: 'org-1', user_id: 'p-1', course_id: 'c-1',
          status: 'completed', enrolled_at: '2026-06-01T00:00:00Z',
          completed_at: '2026-06-10T00:00:00Z',
          course: { id: 'c-1', title: 'Finished Course', level: 'basic', description: '' },
        },
        {
          id: 'e-2', org_id: 'org-1', user_id: 'p-1', course_id: 'c-2',
          status: 'enrolled', enrolled_at: '2026-06-02T00:00:00Z', completed_at: null,
          course: { id: 'c-2', title: 'Ongoing Course', level: 'basic', description: '' },
        },
      ],
      progress: { 'c-1': { total: 4, completed: 4 }, 'c-2': { total: 4, completed: 1 } },
    });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
      currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
    });

    renderDashboard();

    // Stat card: dashboard.completed must show 1 (counts enrollments.status === 'completed')
    const completedTitle = await screen.findByText('dashboard.completed');
    const completedCard = completedTitle.closest('.rounded-2xl') as HTMLElement;
    expect(completedCard).not.toBeNull();
    expect(within(completedCard).getByText('1')).toBeInTheDocument();

    // The completed course is listed under Completed Courses, the ongoing one under Continue Learning
    expect(screen.getByText('dashboard.completedCourses')).toBeInTheDocument();
    expect(screen.getByText('Finished Course')).toBeInTheDocument();
    // The ongoing course renders twice: as the hero card title and in the In-progress grid
    expect(screen.getAllByText('Ongoing Course')).toHaveLength(2);
  });
});

describe('LearnerDashboard — assessment banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withOrg = {
    memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
    currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
  };

  it('shows the banner when the learner has no assessment level', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ enrollments: [], progress: {} });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      ...withOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
    });

    renderDashboard();

    expect(await screen.findByTestId('assessment-banner')).toBeInTheDocument();
    expect(screen.getByText('assessment.banner.title')).toBeInTheDocument();
    expect(screen.getByText('assessment.banner.cta')).toBeInTheDocument();
  });

  it('does NOT show the banner when the learner already has an assessment level', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ enrollments: [], progress: {} });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      ...withOrg,
      profile: { ...baseAuthState.profile, assessment_level: 'basic' },
    });

    renderDashboard();

    // Wait for the page to settle (hero card appears) then assert banner absent
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByTestId('assessment-banner')).toBeNull();
  });

  it('does NOT show the banner for a platform admin even with no assessment level', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      profile: { ...baseAuthState.profile, assessment_level: null },
      isPlatformAdmin: true,
      memberships: [],
      currentOrg: null,
    });

    renderDashboard();

    // Platform admin with no org renders the no-membership state, not the dashboard
    expect(screen.queryByTestId('assessment-banner')).toBeNull();
  });

  it('does NOT show the banner for an org admin even with no assessment level', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ enrollments: [], progress: {} });
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      ...withOrg,
      profile: { ...baseAuthState.profile, assessment_level: null },
      isOrgAdmin: true,
    });

    renderDashboard();

    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByTestId('assessment-banner')).toBeNull();
  });
});

describe('LearnerDashboard — failed fetch shows error fork, not first-time hero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the retryable error state (not the first-time hero) when the dashboard fetch fails', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockRejectedValue(new Error('boom'));
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
      currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
    });

    renderDashboard();

    // Error fork copy + retry button appear...
    expect(await screen.findByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
    // ...and the first-time hero (success-empty state) does NOT.
    expect(screen.queryByTestId('dashboard-hero')).toBeNull();
    expect(screen.queryByText('dashboard.heroFirstTimeTitle')).toBeNull();
  });
});

describe('LearnerDashboard — hero variants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
      currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
    });
  });

  const enrolled = {
    id: 'e-2', org_id: 'org-1', user_id: 'p-1', course_id: 'c-2',
    status: 'enrolled', enrolled_at: '2026-06-02T00:00:00Z', completed_at: null,
    course: { id: 'c-2', title: 'Ongoing Course', level: 'basic', description: '' },
  };
  const completed = {
    id: 'e-1', org_id: 'org-1', user_id: 'p-1', course_id: 'c-1',
    status: 'completed', enrolled_at: '2026-06-01T00:00:00Z',
    completed_at: '2026-06-10T00:00:00Z',
    course: { id: 'c-1', title: 'Finished Course', level: 'basic', description: '' },
  };

  it('shows the continue-learning variant when a course is in progress', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({
      enrollments: [completed, enrolled],
      progress: { 'c-1': { total: 4, completed: 4 }, 'c-2': { total: 4, completed: 1 } },
    });

    renderDashboard();

    const hero = await screen.findByTestId('dashboard-hero');
    expect(within(hero).getByText('dashboard.heroContinueBadge')).toBeInTheDocument();
    expect(within(hero).getByText('Ongoing Course')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.heroLessonsDone')).toBeInTheDocument();
    // Ring reflects the in-progress course (1 of 4 lessons = 25%)
    expect(within(hero).getByText('25%')).toBeInTheDocument();
    // CTA resumes the in-progress course
    const cta = within(hero).getByRole('link', { name: /dashboard\.heroResumeCta/ });
    expect(cta).toHaveAttribute('href', '/app/learn/c-2');
  });

  it('shows the all-caught-up variant with a 100% ring when everything is completed', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({
      enrollments: [completed],
      progress: { 'c-1': { total: 4, completed: 4 } },
    });

    renderDashboard();

    const hero = await screen.findByTestId('dashboard-hero');
    expect(within(hero).getByText('dashboard.heroAllCaughtUpBadge')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.heroAllDoneTitle')).toBeInTheDocument();
    expect(within(hero).getByText('100%')).toBeInTheDocument();
    // CTA suggests starting a new course, pointing at the catalog
    const cta = within(hero).getByRole('link', { name: /dashboard\.heroStartNewCta/ });
    expect(cta).toHaveAttribute('href', '/app/courses');
  });

  it('shows the first-time variant with a 0% ring when there are no enrollments', async () => {
    const { callApi } = await import('@/lib/api-client');
    vi.mocked(callApi).mockResolvedValue({ enrollments: [], progress: {} });

    renderDashboard();

    const hero = await screen.findByTestId('dashboard-hero');
    expect(within(hero).getByText('dashboard.heroFirstTimeBadge')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.heroFirstTimeTitle')).toBeInTheDocument();
    expect(within(hero).getByText('0%')).toBeInTheDocument();
    const cta = within(hero).getByRole('link', { name: /dashboard\.browseCourses/ });
    expect(cta).toHaveAttribute('href', '/app/courses');
  });
});
