import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { CommunityPost, CommunityScope } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/components/community/PostCard', () => ({
  PostCard: ({ post, onClick }: { post: CommunityPost; onClick?: () => void }) => (
    <div data-testid="post-card" data-postid={post.id} onClick={onClick}>
      {post.title}
    </div>
  ),
}));

vi.mock('@/components/community/UpcomingEvents', () => ({
  UpcomingEvents: ({
    events,
    onEventClick,
  }: {
    events: CommunityPost[];
    onEventClick?: (e: CommunityPost) => void;
  }) => (
    <div data-testid="upcoming-events" data-count={events.length}>
      {events.map((e) => (
        <button key={e.id} data-testid="event" onClick={() => onEventClick?.(e)}>
          {e.title}
        </button>
      ))}
    </div>
  ),
}));

const mockUseCommunityEvents = vi.fn();
vi.mock('@/hooks/useCommunityEvents', () => ({
  useCommunityEvents: (scope: CommunityScope, orgId?: string) =>
    mockUseCommunityEvents(scope, orgId),
}));

import { DashboardCommunitySection } from './DashboardCommunitySection';

function post(
  id: string,
  createdAt: string,
  scope: CommunityScope = 'org',
  extra: Partial<CommunityPost> = {},
): CommunityPost {
  return {
    id,
    title: `Post ${id}`,
    scope,
    created_at: createdAt,
    event_date: null,
    ...extra,
  } as CommunityPost;
}

function qr(data: CommunityPost[] = [], over: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), ...over };
}

function wire(byScope: Partial<Record<CommunityScope, ReturnType<typeof qr>>>) {
  mockUseCommunityEvents.mockImplementation((scope: CommunityScope) => byScope[scope] ?? qr([]));
}

function renderSection() {
  return render(
    <MemoryRouter>
      <DashboardCommunitySection orgId="org-1" />
    </MemoryRouter>,
  );
}

describe('DashboardCommunitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wire({});
  });

  it('shows the 4 most-recent posts (merged across scopes), newest first, dropping the 5th', () => {
    wire({
      global: qr([post('a', '2026-07-01T00:00:00Z', 'global'), post('b', '2026-07-05T00:00:00Z', 'global')]),
      org: qr([
        post('c', '2026-07-03T00:00:00Z'),
        post('d', '2026-07-07T00:00:00Z'),
        post('e', '2026-07-06T00:00:00Z'),
      ]),
    });

    renderSection();

    const cards = screen.getAllByTestId('post-card');
    expect(cards).toHaveLength(4);
    const ids = cards.map((c) => c.getAttribute('data-postid'));
    expect(ids).toEqual(['d', 'e', 'b', 'c']);
    expect(ids).not.toContain('a');
  });

  it('links "View all" to the community feed', () => {
    renderSection();
    const link = screen.getByRole('link', { name: 'dashboard.community.viewAll' });
    expect(link).toHaveAttribute('href', '/app/community');
  });

  it('renders the empty state when there are no posts', () => {
    renderSection();
    expect(screen.getByText('dashboard.community.noActivityTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('post-card')).toBeNull();
  });

  it('navigates to a post detail (its own scope) when a post is clicked', () => {
    wire({ org: qr([post('x', '2026-07-01T00:00:00Z', 'org')]) });

    renderSection();

    fireEvent.click(screen.getByTestId('post-card'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/org/posts/x');
  });

  it('passes the merged posts to UpcomingEvents and navigates on an event click', () => {
    wire({
      global: qr([post('g1', '2026-07-01T00:00:00Z', 'global', { event_date: '2026-08-01T10:00:00Z' })]),
      org: qr([post('o1', '2026-07-02T00:00:00Z', 'org', { event_date: '2026-08-02T10:00:00Z' })]),
    });

    renderSection();

    const events = screen.getByTestId('upcoming-events');
    expect(events).toHaveAttribute('data-count', '2');

    fireEvent.click(within(events).getByText('Post g1'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/community/global/posts/g1');
  });

  it('shows a spinner while either query is loading', () => {
    wire({ global: qr([], { isLoading: true }) });

    const { container } = renderSection();

    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('post-card')).toBeNull();
  });

  it('surfaces a retryable error state and refetches both scopes on retry', () => {
    const globalResult = qr([], { isError: true });
    const orgResult = qr([], { isError: true });
    wire({ global: globalResult, org: orgResult });

    renderSection();

    const retry = screen.getByRole('button', { name: 'common.retry' });
    fireEvent.click(retry);
    expect(globalResult.refetch).toHaveBeenCalled();
    expect(orgResult.refetch).toHaveBeenCalled();
  });
});
