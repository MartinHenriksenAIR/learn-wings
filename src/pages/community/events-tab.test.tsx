import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- AppLayout passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- stub the feed's heavy children (not under test here) ---
vi.mock('@/components/community/PostCard', () => ({
  PostCard: ({ post }: { post: { title: string } }) => <div data-testid="post-card">{post.title}</div>,
}));
vi.mock('@/components/community/PostForm', () => ({ PostForm: () => null }));
vi.mock('@/components/community/CommunityEmptyState', () => ({
  CommunityEmptyState: () => <div data-testid="empty-state" />,
}));
vi.mock('@/components/community/AIChampionsList', () => ({ AIChampionsList: () => null }));
vi.mock('@/components/community/UpcomingEvents', () => ({ UpcomingEvents: () => null }));

// --- mock the community api: fetchPosts returns events per scope ---
const mockFetchPosts = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPosts: (...args: unknown[]) => mockFetchPosts(...args),
  fetchCategories: vi.fn().mockResolvedValue([]),
  createPost: vi.fn(),
  togglePostHidden: vi.fn(),
  togglePostLocked: vi.fn(),
}));

// --- t returns the key; language is 'en' so real formatDate stays English ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { community_enabled: true }, isLoading: false }),
}));

import CommunityFeed from './CommunityFeed';

const authState = {
  user: { id: 'oid-1', email: 'u@example.com', name: 'User' },
  profile: { id: 'profile-1', is_platform_admin: false },
  memberships: [{ id: 'm-1', role: 'member', status: 'active' }],
  currentOrg: { id: 'org-1', name: 'Test Org' },
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

const eventsCategory = { id: 'cat-events', slug: 'events', name: 'Events' };

// Clearly-past / clearly-future dates keep the isFuture/isToday cut deterministic.
const globalPosts = [
  {
    id: 'past',
    title: 'Past Global Event',
    category: eventsCategory,
    event_date: '2000-01-01T10:00:00Z',
    event_registration_url: 'https://example.com/past',
  },
  {
    id: 'later',
    title: 'Later Global Event',
    category: eventsCategory,
    event_date: '2999-06-01T10:00:00Z',
    event_registration_url: 'https://example.com/later',
  },
  {
    id: 'soon',
    title: 'Soon Global Event',
    category: eventsCategory,
    event_date: '2999-01-01T10:00:00Z',
    event_registration_url: 'https://example.com/soon',
  },
  {
    id: 'regular',
    title: 'Regular Global Post',
    category: { id: 'cat-gen', slug: 'general', name: 'General' },
    event_date: null,
    event_registration_url: null,
  },
];

const orgPosts = [
  {
    id: 'org-mid',
    title: 'Mid Org Event',
    category: eventsCategory,
    event_date: '2999-03-01T10:00:00Z',
    event_registration_url: 'https://example.com/org-mid',
  },
];

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <CommunityFeed />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Community Events tab (#125)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(authState);
    mockFetchPosts.mockImplementation((filters: { scope: string }) =>
      Promise.resolve(filters.scope === 'org' ? orgPosts : globalPosts),
    );
  });

  it('renders the events view on the ?scope=events deep link', async () => {
    renderAt('/community?scope=events');

    expect(await screen.findByText('Soon Global Event')).toBeInTheDocument();
    // No feed chrome on the events view.
    expect(screen.queryByPlaceholderText('community.searchPosts')).not.toBeInTheDocument();
  });

  it('excludes past-dated events and non-event posts', async () => {
    renderAt('/community?scope=events');

    await screen.findByText('Soon Global Event');
    expect(screen.queryByText('Past Global Event')).not.toBeInTheDocument();
    expect(screen.queryByText('Regular Global Post')).not.toBeInTheDocument();
  });

  it('merges global + current-org events, soonest first', async () => {
    renderAt('/community?scope=events');

    await screen.findByText('Soon Global Event');
    // Org event is merged in.
    expect(screen.getByText('Mid Org Event')).toBeInTheDocument();

    // Join links appear in soonest-first order: soon (2999-01) < org-mid
    // (2999-03) < later (2999-06).
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/soon',
      'https://example.com/org-mid',
      'https://example.com/later',
    ]);
  });

  it('sources the Join href from event_registration_url and opens a new tab', async () => {
    renderAt('/community?scope=events');

    await screen.findByText('Soon Global Event');
    const soonLink = screen.getAllByRole('link')[0];
    expect(soonLink).toHaveAttribute('href', 'https://example.com/soon');
    expect(soonLink).toHaveAttribute('target', '_blank');
    expect(soonLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('switches to the events view when the tab is clicked', async () => {
    renderAt('/community?scope=global');

    // Feed view first — the events rows (and their Join links) are not shown.
    // (The stubbed PostCard renders titles, so we key off the Join links, which
    // only the events view emits.)
    await waitFor(() => expect(mockFetchPosts).toHaveBeenCalled());
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    const eventsTab = screen.getByRole('tab', { name: /community\.eventsOfficeHours/ });
    fireEvent.click(eventsTab);

    expect(await screen.findByText('Mid Org Event')).toBeInTheDocument();
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
