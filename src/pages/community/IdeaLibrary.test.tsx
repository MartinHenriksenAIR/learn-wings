import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock AppLayout as passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- stub heavy child components ---
vi.mock('@/components/community/IdeaCard', () => ({
  IdeaCard: ({ idea }: { idea: { id: string } }) => <div data-testid="idea-card">{idea.id}</div>,
}));
vi.mock('@/components/community/CommunityEmptyState', () => ({
  CommunityEmptyState: () => <div data-testid="empty-state" />,
}));

// --- mock the ideas api ---
const mockFetchIdeas = vi.fn();
const mockFetchOrgTags = vi.fn();
vi.mock('@/lib/ideas-api', () => ({
  fetchIdeas: (...args: unknown[]) => mockFetchIdeas(...args),
  fetchOrgTags: (...args: unknown[]) => mockFetchOrgTags(...args),
  deleteIdea: vi.fn(),
}));

// --- mock sonner toast ---
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// --- useAuth mock: user.id (Entra OID) is DELIBERATELY different from profile.id
//     (the DB row UUID) — pre-migration the legacy backend made them the same value, Entra does not ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { community_enabled: true }, isLoading: false }),
}));

import IdeaLibrary from './IdeaLibrary';

const authState = {
  user: { id: 'oid-entra-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
  profile: { id: 'profile-uuid-1', is_platform_admin: false, first_name: 'Test', last_name: 'User' },
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

function renderDraftsTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/community/org/ideas?tab=drafts']}>
        <IdeaLibrary />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IdeaLibrary drafts tab — caller identity is the profile id, not the Entra OID', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(authState);
    mockFetchIdeas.mockResolvedValue([]);
    mockFetchOrgTags.mockResolvedValue([]);
  });

  it('passes profile.id (not user.id/OID) as the drafts user_id filter', async () => {
    renderDraftsTab();

    await waitFor(() => expect(mockFetchIdeas).toHaveBeenCalled());

    expect(mockFetchIdeas).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ status: ['draft'], user_id: 'profile-uuid-1' })
    );
  });

  it('renders drafts owned by the caller profile id (client-side safety filter)', async () => {
    mockFetchIdeas.mockResolvedValue([
      { id: 'idea-1', user_id: 'profile-uuid-1', status: 'draft', title: 'My draft', tags: [] },
    ]);

    renderDraftsTab();

    await waitFor(() => expect(screen.getByTestId('idea-card')).toBeInTheDocument());
  });
});
