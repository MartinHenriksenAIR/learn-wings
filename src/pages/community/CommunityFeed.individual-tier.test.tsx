import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/community/PostCard', () => ({
  PostCard: ({ post }: { post: { title: string } }) => <div data-testid="post-card">{post.title}</div>,
}));
vi.mock('@/components/community/PostForm', () => ({ PostForm: () => null }));
vi.mock('@/components/community/CommunityEmptyState', () => ({
  CommunityEmptyState: () => <div data-testid="empty-state" />,
}));
vi.mock('@/components/community/AIChampionsList', () => ({
  AIChampionsList: () => <div data-testid="ai-champions" />,
}));
vi.mock('@/components/community/UpcomingEvents', () => ({ UpcomingEvents: () => null }));

const mockFetchPosts = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPosts: (...args: unknown[]) => mockFetchPosts(...args),
  fetchCategories: vi.fn().mockResolvedValue([]),
  createPost: vi.fn(),
  togglePostHidden: vi.fn(),
  togglePostLocked: vi.fn(),
}));

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

describe('CommunityFeed — individual tier treats the placeholder org as no-org (#354)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPosts.mockResolvedValue([]);
  });

  it('individual learner: no org tab, defaults to global, and no org-only extras', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      currentOrg: { id: 'org-solo', name: 'Individuals', kind: 'individual' },
    });
    renderAt('/community');

    // The org→global redirect fires (placeholder counts as no org), so the feed
    // lands on the global scope and fetches global posts.
    await waitFor(() =>
      expect(mockFetchPosts).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global' })),
    );

    // Exactly the Global + Events tabs — no tab bearing the placeholder org name.
    expect(screen.getByRole('tab', { name: /community\.globalCommunity/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /community\.eventsOfficeHours/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Individuals/ })).not.toBeInTheDocument();

    // Org scope is never fetched for a placeholder learner.
    expect(mockFetchPosts).not.toHaveBeenCalledWith(expect.objectContaining({ scope: 'org' }));

    // Org-only sidebar extras are absent.
    expect(screen.queryByText('community.ideaLibrary')).not.toBeInTheDocument();
    expect(screen.queryByText('community.resourceLibrary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-champions')).not.toBeInTheDocument();
  });

  it('standard org (regression): org tab present, defaults to org scope, org extras shown', async () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      currentOrg: { id: 'org-std', name: 'Contoso', kind: 'standard' },
    });
    renderAt('/community');

    await waitFor(() =>
      expect(mockFetchPosts).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'org', org_id: 'org-std' }),
      ),
    );

    expect(screen.getByRole('tab', { name: /Contoso/ })).toBeInTheDocument();
    expect(screen.getByText('community.ideaLibrary')).toBeInTheDocument();
    expect(screen.getByText('community.resourceLibrary')).toBeInTheDocument();
    expect(screen.getByTestId('ai-champions')).toBeInTheDocument();
  });
});
