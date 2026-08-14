import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { LearnerDashboardData } from '@/hooks/useLearnerDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const mockCommunityGate = vi.fn(() => 'blocked');
vi.mock('@/hooks/useCommunityGate', () => ({ useCommunityGate: () => mockCommunityGate() }));

vi.mock('@/components/learner/DashboardCommunitySection', () => ({
  DashboardCommunitySection: () => <div data-testid="community-section" />,
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

const withOrg = {
  memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
};

const dashData = (over: Partial<LearnerDashboardData> = {}): LearnerDashboardData => ({
  snapshot: { started: 3, inProgress: 1, completed: 2, overallPct: 67 },
  xp: { allTime: 75, month: 45 },
  level: { level: 1, xp: 75, xpIntoLevel: 75, xpForLevel: 200, xpToNext: 125, nextThreshold: 200, progressPct: 38 },
  streak: { current: 3, activeToday: true },
  showLeaderboard: true,
  leaderboard: {
    allTime: {
      rows: [
        { rank: 1, name: 'Anna B.', xp: 300, isSelf: false },
        { rank: 2, name: 'Martin H.', xp: 75, isSelf: true },
      ],
      me: { rank: 2, name: 'Martin H.', xp: 75, isSelf: true },
    },
    month: {
      rows: [{ rank: 1, name: 'Martin H.', xp: 45, isSelf: true }],
      me: { rank: 1, name: 'Martin H.', xp: 45, isSelf: true },
    },
  },
  ...over,
});

async function mockData(data: LearnerDashboardData | Error) {
  const { callApi } = await import('@/lib/api-client');
  if (data instanceof Error) vi.mocked(callApi).mockRejectedValue(data);
  else vi.mocked(callApi).mockResolvedValue(data);
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearnerDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LearnerDashboard — guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the invitation-only empty state for a non-admin with no memberships (blocked walk-in)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, memberships: [], currentOrg: null });
    renderDashboard();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByText('dashboard.invitationOnlyTitle')).toBeInTheDocument();
    expect(screen.getByText('dashboard.invitationOnlyDescription')).toBeInTheDocument();
  });

  it('shows the no-org-selected state when memberships exist but no org is selected', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'org_admin', status: 'active' }],
      currentOrg: null,
      isPlatformAdmin: true,
      effectiveIsPlatformAdmin: true,
    });
    renderDashboard();
    expect(screen.getByText('common.noOrgSelected')).toBeInTheDocument();
  });

  it('does NOT render the spinner when user is null (unauthenticated)', () => {
    mockUseAuth.mockReturnValue({ ...baseAuthState, user: null, profile: null });
    renderDashboard();
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('renders the retryable error fork (not an all-zero hub) when the fetch fails', async () => {
    await mockData(new Error('boom'));
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
    renderDashboard();
    expect(await screen.findByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-snapshot')).toBeNull();
  });
});

describe('LearnerDashboard — motivation hub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('renders the progress snapshot with counts', async () => {
    await mockData(dashData());
    renderDashboard();
    const snapshot = await screen.findByTestId('dashboard-snapshot');
    expect(within(snapshot).getByText('dashboard.started')).toBeInTheDocument();
    expect(within(snapshot).getByText('67%')).toBeInTheDocument();
  });

  it('renders XP/level and streak', async () => {
    await mockData(dashData());
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.getByText('dashboard.level.label')).toBeInTheDocument();
    expect(screen.getByText('dashboard.level.toNext')).toBeInTheDocument();
    expect(screen.getByText('dashboard.streak.days')).toBeInTheDocument();
  });

  it('renders the org leaderboard with first-name+initial names and XP', async () => {
    await mockData(dashData());
    renderDashboard();
    const board = await screen.findByTestId('dashboard-leaderboard');
    expect(within(board).getByText('Anna B.')).toBeInTheDocument();
    expect(within(board).getByText('300 XP')).toBeInTheDocument();
    expect(within(board).getByText('Martin H.')).toBeInTheDocument();
  });

  it('switches the leaderboard window to this month', async () => {
    await mockData(dashData());
    renderDashboard();
    const board = await screen.findByTestId('dashboard-leaderboard');
    fireEvent.click(within(board).getByRole('button', { name: 'dashboard.leaderboard.thisMonth' }));
    expect(within(board).getByText('45 XP')).toBeInTheDocument();
  });

  it('hides the leaderboard for an individual-tier learner (server sets showLeaderboard=false)', async () => {
    await mockData(dashData({ showLeaderboard: false }));
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
      currentOrg: { id: 'org-solo', name: 'Individuals', slug: 'individuals', kind: 'individual' },
    });
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.queryByTestId('dashboard-leaderboard')).toBeNull();
  });

  it('hides the leaderboard when the org opted out (#369: showLeaderboard=false in a standard org)', async () => {
    await mockData(dashData({ showLeaderboard: false }));
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.queryByTestId('dashboard-leaderboard')).toBeNull();
  });

  it('pins the caller row when they rank below the visible top', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: `User ${i}`, xp: 1000 - i, isSelf: false }));
    await mockData(dashData({
      leaderboard: {
        allTime: { rows, me: { rank: 42, name: 'Martin H.', xp: 5, isSelf: true } },
        month: { rows: [], me: null },
      },
    }));
    renderDashboard();
    const board = await screen.findByTestId('dashboard-leaderboard');
    expect(within(board).getByText('dashboard.leaderboard.yourRank')).toBeInTheDocument();
    expect(within(board).getByText('Martin H.')).toBeInTheDocument();
  });
});

describe('LearnerDashboard — assessment banner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the banner when a learner has no assessment level', async () => {
    await mockData(dashData());
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg, profile: { ...baseAuthState.profile, assessment_level: null } });
    renderDashboard();
    expect(await screen.findByTestId('assessment-banner')).toBeInTheDocument();
  });

  it('hides the banner when the learner already has an assessment level', async () => {
    await mockData(dashData());
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg, profile: { ...baseAuthState.profile, assessment_level: 'basic' } });
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.queryByTestId('assessment-banner')).toBeNull();
  });

  it('hides the banner for an org admin', async () => {
    await mockData(dashData());
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg, profile: { ...baseAuthState.profile, assessment_level: null }, isOrgAdmin: true });
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.queryByTestId('assessment-banner')).toBeNull();
  });
});

describe('LearnerDashboard — community gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('renders the community section when the gate allows it', async () => {
    mockCommunityGate.mockReturnValue('allowed');
    await mockData(dashData());
    renderDashboard();
    expect(await screen.findByTestId('community-section')).toBeInTheDocument();
  });

  it('hides the community section when the gate blocks it', async () => {
    mockCommunityGate.mockReturnValue('blocked');
    await mockData(dashData());
    renderDashboard();
    await screen.findByTestId('dashboard-snapshot');
    expect(screen.queryByTestId('community-section')).toBeNull();
  });
});
