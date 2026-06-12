import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock AppLayout as passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- stub heavy child components ---
vi.mock('@/components/community/CategoryBadge', () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));
vi.mock('@/components/community/TagList', () => ({
  TagList: () => <div data-testid="tag-list" />,
}));
vi.mock('@/components/community/CommentThread', () => ({
  CommentThread: () => <div data-testid="comment-thread" />,
}));
vi.mock('@/components/community/ReportDialog', () => ({
  ReportDialog: () => <div data-testid="report-dialog" />,
}));

// --- mock toast (PostDetail imports from '@/components/ui/sonner') ---
vi.mock('@/components/ui/sonner', () => ({ toast: vi.fn() }));

// --- mock the community api ---
const mockFetchPost = vi.fn();
const mockFetchComments = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPost: (...args: unknown[]) => mockFetchPost(...args),
  fetchComments: (...args: unknown[]) => mockFetchComments(...args),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  createReport: vi.fn(),
  deletePost: vi.fn(),
  togglePostHidden: vi.fn(),
  togglePostLocked: vi.fn(),
  toggleCommentHidden: vi.fn(),
}));

// --- configurable hook mocks ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUsePlatformSettings = vi.fn();
vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => mockUsePlatformSettings(),
}));

import PostDetail from './PostDetail';

const basePost = {
  id: 'post-1',
  user_id: 'author-uuid',
  scope: 'org',
  org_id: 'org-1',
  title: 'Reported Org Post',
  content: 'Some content body',
  created_at: '2026-01-01T10:00:00.000Z',
  is_pinned: false,
  is_locked: false,
  is_hidden: false,
  category: { name: 'General', icon: 'message-square', is_restricted: false, slug: 'general' },
  profile: { id: 'author-uuid', full_name: 'Jane Doe' },
  organization: { id: 'org-1', name: 'Reported Org' },
  tags: [],
};

// useAuth state: community disabled for the viewer's own org; only effectiveIsPlatformAdmin varies.
function makeAuth(effectiveIsPlatformAdmin: boolean) {
  return {
    user: { id: 'oid-entra-1', tid: 'tid-1', email: 'admin@example.com', name: 'Admin User' },
    profile: { id: 'viewer-uuid', is_platform_admin: effectiveIsPlatformAdmin, first_name: 'Admin', last_name: 'User' },
    memberships: [],
    currentOrg: null,
    isPlatformAdmin: effectiveIsPlatformAdmin,
    isOrgAdmin: false,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshUserContext: vi.fn(),
    setCurrentOrg: vi.fn(),
    viewMode: effectiveIsPlatformAdmin ? ('platform_admin' as const) : ('learner' as const),
    setViewMode: vi.fn(),
    effectiveIsPlatformAdmin,
    effectiveIsOrgAdmin: false,
  };
}

function renderPost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/community/org/posts/post-1']}>
        <Routes>
          <Route path="/app/community/:scope/posts/:postId" element={<PostDetail />} />
          <Route path="/app/dashboard" element={<div>DASHBOARD SENTINEL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PostDetail community gate (#89)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPost.mockResolvedValue(basePost);
    mockFetchComments.mockResolvedValue([]);
    // The viewer's effective flags report community DISABLED for their own org context.
    mockUsePlatformSettings.mockReturnValue({ features: { community_enabled: false }, isLoading: false });
  });

  it('does NOT bounce a platform admin to the dashboard when their own org has community disabled', async () => {
    mockUseAuth.mockReturnValue(makeAuth(true));
    renderPost();

    // Platform admin is exempt from the viewer-org gate: the reported post renders.
    expect(await screen.findByText('Reported Org Post')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD SENTINEL')).not.toBeInTheDocument();
  });

  it('redirects a non-admin viewer to the dashboard when community is disabled', async () => {
    mockUseAuth.mockReturnValue(makeAuth(false));
    renderPost();

    expect(await screen.findByText('DASHBOARD SENTINEL')).toBeInTheDocument();
    expect(screen.queryByText('Reported Org Post')).not.toBeInTheDocument();
  });
});
