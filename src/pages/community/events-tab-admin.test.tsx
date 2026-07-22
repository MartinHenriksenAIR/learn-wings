import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- AppLayout passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- stub heavy children not under test ---
vi.mock('@/components/community/PostCard', () => ({
  PostCard: ({ post }: { post: { title: string } }) => <div>{post.title}</div>,
}));
vi.mock('@/components/community/AIChampionsList', () => ({ AIChampionsList: () => null }));
vi.mock('@/components/community/UpcomingEvents', () => ({ UpcomingEvents: () => null }));
vi.mock('@/components/community/EventCard', () => ({
  EventCard: ({ event }: { event: { title: string } }) => (
    <div data-testid="event-card">{event.title}</div>
  ),
}));

// --- PostForm: surface the props that prove events-preselection + scope ---
vi.mock('@/components/community/PostForm', () => ({
  PostForm: ({
    open,
    scope,
    initialData,
  }: {
    open: boolean;
    scope: string;
    initialData?: { category_id?: string };
  }) =>
    open ? (
      <div
        data-testid="post-form"
        data-scope={scope}
        data-category={initialData?.category_id ?? ''}
      />
    ) : null,
}));

// --- community api: fetchPosts drives the events tab ---
const mockFetchPosts = vi.fn();
const eventsCategory = { id: 'cat-events', slug: 'events', name: 'Events' };
vi.mock('@/lib/community-api', () => ({
  fetchPosts: (...args: unknown[]) => mockFetchPosts(...args),
  fetchCategories: vi.fn().mockResolvedValue([{ id: 'cat-events', slug: 'events', name: 'Events' }]),
  createPost: vi.fn(),
  togglePostHidden: vi.fn(),
  togglePostLocked: vi.fn(),
}));

// --- t returns the key so assertions can key off it ---
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

const baseAuth = {
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

const platformAdmin = { ...baseAuth, effectiveIsPlatformAdmin: true, isPlatformAdmin: true };
const orgAdmin = { ...baseAuth, effectiveIsOrgAdmin: true, isOrgAdmin: true };
const learner = baseAuth;

const futureEvent = {
  id: 'ev-1',
  title: 'Future Event',
  category: eventsCategory,
  event_date: '2999-01-01T10:00:00Z',
  event_registration_url: 'https://example.com/ev1',
};

function renderEventsTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/community?scope=events']}>
        <CommunityFeed />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Community Events tab — admin affordance + empty state (#125)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with upcoming events present', () => {
    beforeEach(() => {
      mockFetchPosts.mockImplementation((filters: { scope: string }) =>
        Promise.resolve(filters.scope === 'org' ? [] : [futureEvent]),
      );
    });

    it('shows New Event for a platform admin and opens the form preselected to events, scope global', async () => {
      mockUseAuth.mockReturnValue(platformAdmin);
      renderEventsTab();

      await screen.findByTestId('event-card');
      const newEvent = screen.getByRole('button', { name: 'community.newEvent' });
      expect(newEvent).toBeInTheDocument();
      // No "New Post" label on the events view.
      expect(screen.queryByText('community.newPost')).not.toBeInTheDocument();

      fireEvent.click(newEvent);

      const form = await screen.findByTestId('post-form');
      expect(form).toHaveAttribute('data-scope', 'global');
      expect(form).toHaveAttribute('data-category', 'cat-events');
    });

    it('shows New Event for an org admin and opens the form scoped to the org', async () => {
      mockUseAuth.mockReturnValue(orgAdmin);
      renderEventsTab();

      await screen.findByTestId('event-card');
      const newEvent = screen.getByRole('button', { name: 'community.newEvent' });
      fireEvent.click(newEvent);

      const form = await screen.findByTestId('post-form');
      expect(form).toHaveAttribute('data-scope', 'org');
      expect(form).toHaveAttribute('data-category', 'cat-events');
    });

    it('hides New Event from a learner', async () => {
      mockUseAuth.mockReturnValue(learner);
      renderEventsTab();

      await screen.findByTestId('event-card');
      expect(screen.queryByRole('button', { name: 'community.newEvent' })).not.toBeInTheDocument();
    });

    it('hides the Submit Idea button on the events view', async () => {
      mockUseAuth.mockReturnValue(orgAdmin);
      renderEventsTab();

      await screen.findByTestId('event-card');
      expect(screen.queryByText('community.submitIdea')).not.toBeInTheDocument();
    });
  });

  describe('with no upcoming events', () => {
    beforeEach(() => {
      mockFetchPosts.mockResolvedValue([]);
    });

    it('renders the events empty-state variant with a CTA for an admin', async () => {
      mockUseAuth.mockReturnValue(platformAdmin);
      renderEventsTab();

      const title = await screen.findByText('community.emptyState.eventsTitle');
      const emptyState = title.closest('div') as HTMLElement;
      expect(
        within(emptyState).getByRole('button', { name: 'community.newEvent' }),
      ).toBeInTheDocument();
    });

    it('renders the events empty-state variant with no CTA for a learner', async () => {
      mockUseAuth.mockReturnValue(learner);
      renderEventsTab();

      const title = await screen.findByText('community.emptyState.eventsTitle');
      const emptyState = title.closest('div') as HTMLElement;
      expect(within(emptyState).queryByRole('button')).not.toBeInTheDocument();
      // The learner still gets the description, just no action.
      expect(screen.getByText('community.emptyState.eventsDescription')).toBeInTheDocument();
    });
  });
});
