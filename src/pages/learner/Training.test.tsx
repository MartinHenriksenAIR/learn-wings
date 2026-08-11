import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

vi.mock('@/components/learner/CertificateCard', () => ({
  CertificateCard: () => <div data-testid="cert-card" />,
}));

// The Mandatory + Favorites sections are self-contained components with their own
// unit tests; here we stub them to verify the page wires them in with the org id.
vi.mock('@/components/learner/MandatoryCourses', () => ({
  MandatoryCourses: ({ orgId }: { orgId?: string }) => (
    <div data-testid="mandatory-section" data-org={orgId} />
  ),
}));

vi.mock('@/components/learner/FavoriteCourses', () => ({
  FavoriteCourses: ({ orgId }: { orgId?: string }) => (
    <div data-testid="favorites-section" data-org={orgId} />
  ),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const platformDefault = () => ({
  features: { certificates_enabled: false } as Record<string, boolean>,
  isLoading: false,
});
const mockPlatformSettings = vi.fn(platformDefault);
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockPlatformSettings(),
}));

const mockUseLearnerTraining = vi.fn();
vi.mock('@/hooks/useLearnerTraining', () => ({
  useLearnerTraining: (...args: unknown[]) => mockUseLearnerTraining(...args),
}));

import LearnerTraining from './Training';

const baseAuthState = {
  user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'p-1', is_platform_admin: false, full_name: 'Test User', first_name: 'Test', last_name: 'User' },
  memberships: [] as unknown[],
  currentOrg: null as unknown,
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

const withOrg = {
  memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
};

const enrolled = {
  id: 'e-2', org_id: 'org-1', user_id: 'p-1', course_id: 'c-2',
  status: 'enrolled', enrolled_at: '2026-06-02T00:00:00Z', completed_at: null,
  course: { id: 'c-2', title: 'Ongoing Course', level: 'basic', description: '' },
};
const completedEnrollment = {
  id: 'e-1', org_id: 'org-1', user_id: 'p-1', course_id: 'c-1',
  status: 'completed', enrolled_at: '2026-06-01T00:00:00Z', completed_at: '2026-06-10T00:00:00Z',
  course: { id: 'c-1', title: 'Finished Course', level: 'basic', description: '' },
};
// total 8 lessons, 6 done -> 75%
const progress = { 'c-1': { total: 4, completed: 4 }, 'c-2': { total: 4, completed: 2 } };

function setTraining(data: {
  enrollments?: unknown[];
  progress?: Record<string, { total: number; completed: number }>;
  thumbnailUrls?: Record<string, string>;
}, state: Record<string, unknown> = {}) {
  mockUseLearnerTraining.mockReturnValue({
    data: {
      enrollments: data.enrollments ?? [],
      progress: data.progress ?? {},
      thumbnailUrls: data.thumbnailUrls ?? {},
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...state,
  });
}

function renderTraining() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LearnerTraining />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LearnerTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformSettings.mockImplementation(platformDefault);
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
    setTraining({ enrollments: [completedEnrollment, enrolled], progress });
  });

  it('renders the "My Training" h1', () => {
    renderTraining();
    expect(screen.getByRole('heading', { level: 1, name: 'training.title' })).toBeInTheDocument();
  });

  it('shows the lesson-aggregate figure in the progress strip', () => {
    renderTraining();
    const strip = screen.getByTestId('training-progress-strip');
    // 6 of 8 lessons -> 75%
    expect(within(strip).getByText('75%')).toBeInTheDocument();
    expect(within(strip).getByText('training.progress.summary')).toBeInTheDocument();
  });

  it('renders an in-progress card with a resume link to the course player', () => {
    renderTraining();
    const card = screen.getByTestId('training-continue-card');
    expect(within(card).getByText('Ongoing Course')).toBeInTheDocument();
    const resume = within(card).getByRole('link', { name: /common\.continue/ });
    expect(resume).toHaveAttribute('href', '/app/learn/c-2');
  });

  it('wires in the Mandatory and Favorites sections with the current org id (no coming-soon placeholders)', () => {
    renderTraining();
    expect(screen.getByTestId('mandatory-section')).toHaveAttribute('data-org', 'org-1');
    expect(screen.getByTestId('favorites-section')).toHaveAttribute('data-org', 'org-1');
    expect(screen.queryByText('training.comingSoon')).toBeNull();
  });

  it('renders a plain completed card when the certificates feature is off', () => {
    renderTraining();
    expect(screen.getByTestId('training-completed-card')).toBeInTheDocument();
    expect(screen.getByText('Finished Course')).toBeInTheDocument();
    expect(screen.queryByTestId('cert-card')).toBeNull();
  });

  it('renders CertificateCard for completed courses when the certificates feature is on', () => {
    mockPlatformSettings.mockReturnValue({
      features: { certificates_enabled: true },
      isLoading: false,
    });
    renderTraining();
    expect(screen.getByTestId('cert-card')).toBeInTheDocument();
    expect(screen.queryByTestId('training-completed-card')).toBeNull();
  });

  it('shows the empty states and gentle progress strip when there are no enrollments', () => {
    setTraining({ enrollments: [], progress: {} });
    renderTraining();
    expect(screen.getByText('training.progress.empty')).toBeInTheDocument();
    expect(screen.getByText('training.continue.empty')).toBeInTheDocument();
    expect(screen.getByText('training.completed.empty')).toBeInTheDocument();
  });

  it('shows the retryable error state when the training fetch fails', () => {
    setTraining({ enrollments: [], progress: {} }, { isError: true, data: undefined });
    renderTraining();
    expect(screen.getByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
  });

  it('shows the no-membership empty state when the user has no org', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, memberships: [], currentOrg: null });
    setTraining({ enrollments: [], progress: {} });
    renderTraining();
    expect(screen.getByText('dashboard.noMembershipTitle')).toBeInTheDocument();
  });
});
