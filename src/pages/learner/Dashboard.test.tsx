import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { LearnerDashboardData } from '@/hooks/useLearnerDashboard';
import type { CommunityPost } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
  // The hero interpolates its greeting and headline through <Trans>; the key
  // alone is enough for these assertions.
  Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
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

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

const mockFetchPosts = vi.fn(async (_args: { scope: string; org_id?: string }) => [] as CommunityPost[]);
vi.mock('@/lib/community-api', () => ({
  fetchPosts: (args: { scope: string; org_id?: string }) => mockFetchPosts(args),
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
  level: { level: 4, xp: 75, xpIntoLevel: 75, xpForLevel: 200, xpToNext: 125, nextThreshold: 200, progressPct: 38 },
  streak: { current: 3, activeToday: true },
  week: {
    lessons: 6,
    minutes: 510,
    untimedLessons: 0,
    perDayMinutes: [30, 0, 60, 90, 120, 90, 120],
    previous: { lessons: 4, minutes: 300 },
  },
  courses: [
    { courseId: 'c-1', title: 'AI in everyday work', thumbnailUrl: 'https://blob/a.png', lessonsTotal: 9, lessonsCompleted: 4, pct: 44 },
  ],
  recommended: [],
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityGate.mockReturnValue('blocked');
  });

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

  it('renders the retryable error fork (not an all-zero dashboard) when the fetch fails', async () => {
    await mockData(new Error('boom'));
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
    renderDashboard();
    expect(await screen.findByText('common.loadErrorTitle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-hero')).toBeNull();
    expect(screen.queryByTestId('dashboard-snapshot')).toBeNull();
  });
});

describe('LearnerDashboard — hero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityGate.mockReturnValue('blocked');
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('states the lessons completed in the window, the level and overall progress', async () => {
    await mockData(dashData());
    renderDashboard();
    const hero = await screen.findByTestId('dashboard-hero');
    expect(within(hero).getByText('dashboard.hero.headline')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.hero.cta')).toBeInTheDocument();
    expect(within(hero).getByText('67%')).toBeInTheDocument();
    // The level rides on the avatar ring, not a separate card.
    expect(within(hero).getByLabelText('dashboard.level.label')).toHaveTextContent('4');
  });

  it('renders one card per in-progress course', async () => {
    await mockData(dashData());
    renderDashboard();
    const cards = await screen.findAllByTestId('hero-course-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('AI in everyday work');
    expect(cards[0]).toHaveTextContent('dashboard.hero.lessonsAndPct');
  });

  it('asks instead of counting for a learner who has never started a course, and shows recommendations', async () => {
    await mockData(dashData({
      snapshot: { started: 0, inProgress: 0, completed: 0, overallPct: 0 },
      week: { lessons: 0, minutes: 0, untimedLessons: 0, perDayMinutes: [0, 0, 0, 0, 0, 0, 0], previous: { lessons: 0, minutes: 0 } },
      courses: [],
      recommended: [
        { courseId: 'c-9', title: 'Prompt Engineering', thumbnailUrl: null, lessonsTotal: 6, lessonsCompleted: 0, pct: 0 },
      ],
    }));
    renderDashboard();
    const hero = await screen.findByTestId('dashboard-hero');
    expect(within(hero).getByText('dashboard.hero.headlineFresh')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.hero.ctaFresh')).toBeInTheDocument();
    expect(within(hero).getByText('dashboard.hero.lovedLabel')).toBeInTheDocument();
    // No wall of zeros: the overall-progress bar is dropped, and the tiles carry
    // a lesson count with no percentage or bar.
    expect(within(hero).queryByText('dashboard.overallProgress')).toBeNull();
    expect(within(hero).getByText('dashboard.hero.lessonsOnly')).toBeInTheDocument();
    expect(within(hero).queryByText('dashboard.hero.lessonsAndPct')).toBeNull();
  });
});

describe('LearnerDashboard — statistics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityGate.mockReturnValue('blocked');
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('renders the two counters and the learning-time trend with its change figure', async () => {
    await mockData(dashData());
    renderDashboard();
    const stats = await screen.findByTestId('dashboard-snapshot');
    expect(within(stats).getByText('dashboard.stats.coursesInProgress')).toBeInTheDocument();
    expect(within(stats).getByText('dashboard.stats.coursesCompleted')).toBeInTheDocument();
    // 510 min → 8.5 h, up 70% on the previous 300 min.
    expect(within(stats).getByText('8.5')).toBeInTheDocument();
    expect(within(stats).getByText('+70%')).toBeInTheDocument();
  });

  it('drops the change figure when there is no previous window to compare against', async () => {
    await mockData(dashData({
      week: { lessons: 2, minutes: 60, untimedLessons: 0, perDayMinutes: [0, 0, 0, 0, 0, 0, 60], previous: { lessons: 0, minutes: 0 } },
    }));
    renderDashboard();
    const stats = await screen.findByTestId('dashboard-snapshot');
    expect(within(stats).queryByText('dashboard.stats.vsPrevious')).toBeNull();
  });

  it('discloses completed lessons that carry no authored length', async () => {
    await mockData(dashData({
      week: { lessons: 6, minutes: 510, untimedLessons: 2, perDayMinutes: [0, 0, 0, 0, 0, 0, 510], previous: { lessons: 4, minutes: 300 } },
    }));
    renderDashboard();
    const stats = await screen.findByTestId('dashboard-snapshot');
    expect(within(stats).getByText('dashboard.stats.untimed')).toBeInTheDocument();
  });
});

describe('LearnerDashboard — leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityGate.mockReturnValue('blocked');
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('renders the all-time board with no window toggle', async () => {
    await mockData(dashData());
    renderDashboard();
    const board = await screen.findByTestId('dashboard-leaderboard');
    expect(within(board).getByText('Anna B.')).toBeInTheDocument();
    expect(within(board).getByText('300')).toBeInTheDocument();
    // The all-time / this-month tabs were dropped with the redesign (#455).
    expect(within(board).queryAllByRole('button')).toHaveLength(0);
  });

  it('caps the board at four rows and pins the caller below when they rank lower', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: `User ${i}`, xp: 1000 - i, isSelf: false }));
    await mockData(dashData({
      leaderboard: {
        allTime: { rows, me: { rank: 42, name: 'Martin H.', xp: 5, isSelf: true } },
        month: { rows: [], me: null },
      },
    }));
    renderDashboard();
    const board = await screen.findByTestId('dashboard-leaderboard');
    expect(within(board).getByText('User 3')).toBeInTheDocument();
    expect(within(board).queryByText('User 4')).toBeNull();
    expect(within(board).getByText('dashboard.leaderboard.yourRank')).toBeInTheDocument();
    expect(within(board).getByText('Martin H.')).toBeInTheDocument();
  });

  it('hides the board for an individual-tier learner (server sets showLeaderboard=false)', async () => {
    // The individual placeholder org suppresses the board server-side (#354),
    // surfaced to the client as showLeaderboard=false.
    await mockData(dashData({ showLeaderboard: false }));
    mockUseAuth.mockReturnValue({
      ...baseAuthState,
      memberships: [{ id: 'm-1', role: 'learner', status: 'active' }],
      currentOrg: { id: 'org-solo', name: 'Individuals', slug: 'individuals', kind: 'individual' },
    });
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByTestId('dashboard-leaderboard')).toBeNull();
  });

  it('hides the board when the org opted out (#369: showLeaderboard=false in a standard org)', async () => {
    await mockData(dashData({ showLeaderboard: false }));
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByTestId('dashboard-leaderboard')).toBeNull();
  });
});

describe('LearnerDashboard — community gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
  });

  it('renders the community rows and the events rail when the gate allows it', async () => {
    mockCommunityGate.mockReturnValue('allowed');
    // Both scopes are read; only the org feed has anything in it here.
    mockFetchPosts.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === 'org'
        ? ([
            {
              id: 'post-1', scope: 'org', title: 'Copilot is open to everyone', content: 'From Monday…',
              created_at: '2026-08-12T10:00:00Z', comment_count: 12, event_date: null,
              profile: { full_name: 'Mette S.' },
            },
          ] as unknown as CommunityPost[])
        : [],
    );
    await mockData(dashData());
    renderDashboard();
    const community = await screen.findByTestId('dashboard-community');
    expect(within(community).getByText('Copilot is open to everyone')).toBeInTheDocument();
    expect(await screen.findByTestId('dashboard-events')).toBeInTheDocument();
  });

  it('drops community AND events when the gate blocks it, without truncating the rail', async () => {
    mockCommunityGate.mockReturnValue('blocked');
    await mockData(dashData());
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByTestId('dashboard-community')).toBeNull();
    // Events derive from community posts, so they go with it (#455).
    expect(screen.queryByTestId('dashboard-events')).toBeNull();
    // The board is the rail's only remaining occupant and still renders.
    expect(screen.getByTestId('dashboard-leaderboard')).toBeInTheDocument();
    expect(mockFetchPosts).not.toHaveBeenCalled();
  });
});

describe('LearnerDashboard — where everything clicks through to', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommunityGate.mockReturnValue('allowed');
    mockUseAuth.mockReturnValue({ ...baseAuthState, ...withOrg });
    mockFetchPosts.mockImplementation(async ({ scope }) =>
      scope === 'org'
        ? ([
            {
              id: 'post-1', scope: 'org', title: 'Copilot is open to everyone', content: 'From Monday…',
              created_at: '2026-08-12T10:00:00Z', comment_count: 12, event_date: null,
              profile: { full_name: 'Mette S.' },
            },
            {
              id: 'event-1', scope: 'org', title: 'AI coffee break', content: '',
              created_at: '2026-08-11T10:00:00Z', comment_count: 0,
              event_date: '2099-01-20T13:00:00Z', event_location: 'Online',
              profile: { full_name: 'Mette S.' },
            },
          ] as unknown as CommunityPost[])
        : [],
    );
  });

  it('sends the hero CTA to My Training and a course tile to the player', async () => {
    await mockData(dashData());
    renderDashboard();
    const hero = await screen.findByTestId('dashboard-hero');

    fireEvent.click(within(hero).getByText('dashboard.hero.cta'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/training');

    fireEvent.click(within(hero).getAllByTestId('hero-course-card')[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/app/learn/c-1');
  });

  it('sends a brand-new learner to the catalog, and a recommendation to the course page — not the player', async () => {
    await mockData(dashData({
      snapshot: { started: 0, inProgress: 0, completed: 0, overallPct: 0 },
      courses: [],
      recommended: [
        { courseId: 'c-9', title: 'Prompt Engineering', thumbnailUrl: null, lessonsTotal: 6, lessonsCompleted: 0, pct: 0 },
      ],
    }));
    renderDashboard();
    const hero = await screen.findByTestId('dashboard-hero');

    fireEvent.click(within(hero).getByText('dashboard.hero.ctaFresh'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/courses');

    // Nothing to resume yet — a suggestion opens its description first.
    fireEvent.click(within(hero).getAllByTestId('hero-course-card')[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/app/courses/c-9');
  });

  it('opens a community row and its See more', async () => {
    await mockData(dashData());
    renderDashboard();
    const community = await screen.findByTestId('dashboard-community');

    fireEvent.click(within(community).getByText('Copilot is open to everyone'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/org/posts/post-1');

    fireEvent.click(within(community).getByText('dashboard.seeMore'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/community');
  });

  it('opens an event row and its See more', async () => {
    await mockData(dashData());
    renderDashboard();
    const events = await screen.findByTestId('dashboard-events');

    fireEvent.click(within(events).getByText('AI coffee break'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/org/posts/event-1');

    fireEvent.click(within(events).getByText('dashboard.seeMore'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/events');
  });

  it('activates the unboxed rows from the keyboard — they are role=button, not links', async () => {
    await mockData(dashData());
    renderDashboard();
    const community = await screen.findByTestId('dashboard-community');
    const row = within(community).getAllByRole('button')[0];

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/org/posts/post-1');

    mockNavigate.mockClear();
    fireEvent.keyDown(row, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/org/posts/post-1');
  });
});
