import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { mockCallApi } = vi.hoisted(() => ({ mockCallApi: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

import { useLearnerDashboard, type LearnerDashboardData } from './useLearnerDashboard';

const data: LearnerDashboardData = {
  snapshot: { started: 3, inProgress: 1, completed: 2, overallPct: 67 },
  xp: { allTime: 75, month: 45 },
  level: { level: 1, xp: 75, xpIntoLevel: 75, xpForLevel: 200, xpToNext: 125, nextThreshold: 200, progressPct: 38 },
  streak: { current: 3, activeToday: true },
  week: {
    lessons: 6,
    minutes: 90,
    untimedLessons: 0,
    perDayMinutes: [0, 10, 0, 20, 30, 0, 30],
    previous: { lessons: 4, minutes: 60 },
  },
  courses: [],
  recommended: [],
  showLeaderboard: true,
  leaderboard: {
    allTime: { rows: [{ rank: 1, name: 'Anna B.', xp: 300, isSelf: false }], me: { rank: 2, name: 'Martin H.', xp: 75, isSelf: true } },
    month: { rows: [{ rank: 1, name: 'Martin H.', xp: 45, isSelf: true }], me: { rank: 1, name: 'Martin H.', xp: 45, isSelf: true } },
  },
};

function Consumer({ orgId, enabled }: { orgId: string | undefined; enabled?: boolean }) {
  const query = useLearnerDashboard(orgId, enabled !== undefined ? { enabled } : {});
  if (query.isLoading) return <div data-testid="loading">loading</div>;
  return (
    <div>
      <div data-testid="xp">{query.data?.xp.allTime}</div>
      <div data-testid="streak">{query.data?.streak.current}</div>
      <div data-testid="myrank">{query.data?.leaderboard.allTime.me?.rank}</div>
      <div data-testid="thumb">{query.data?.courses[0]?.thumbnailUrl ?? 'none'}</div>
      <div data-testid="rec-thumb">{query.data?.recommended[0]?.thumbnailUrl ?? 'none'}</div>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('useLearnerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls /api/learner-dashboard with the correct { orgId } body', async () => {
    mockCallApi.mockResolvedValue(data);

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/learner-dashboard', { orgId: 'org-1' });
    });
  });

  it('returns the derived gamification payload', async () => {
    mockCallApi.mockResolvedValue(data);

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('xp')).toHaveTextContent('75');
    });
    expect(screen.getByTestId('streak')).toHaveTextContent('3');
    expect(screen.getByTestId('myrank')).toHaveTextContent('2');
  });

  it('signs hero and recommended course thumbnails, leaving the artless ones null', async () => {
    mockCallApi.mockImplementation((path: string) =>
      path === '/api/learner-dashboard'
        ? Promise.resolve({
            ...data,
            courses: [{ courseId: 'c-1', title: 'A', thumbnailUrl: 'lms/a.png', lessonsTotal: 9, lessonsCompleted: 4, pct: 44 }],
            recommended: [{ courseId: 'c-2', title: 'B', thumbnailUrl: null, lessonsTotal: 6, lessonsCompleted: 0, pct: 0 }],
          })
        : Promise.resolve({ url: 'https://blob/signed-a.png' }),
    );

    renderWithClient(<Consumer orgId="org-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('thumb')).toHaveTextContent('https://blob/signed-a.png');
    });
    expect(screen.getByTestId('rec-thumb')).toHaveTextContent('none');
  });

  it('does not fetch when enabled is false', async () => {
    renderWithClient(<Consumer orgId="org-1" enabled={false} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });

  it('does not fetch when orgId is undefined (default enabled gate)', async () => {
    renderWithClient(<Consumer orgId={undefined} />);

    await Promise.resolve();
    expect(mockCallApi).not.toHaveBeenCalled();
  });
});
