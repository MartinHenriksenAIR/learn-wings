import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// #205 — composer avatar parity. Both community comment composers (IdeaDetail's
// and CommentThread's) show the current user's avatar exactly as their posted
// comments render it: the photo when the profile has an uploaded avatar_url,
// coloured initials otherwise. CommentThread's composer avatar is optional —
// with the props omitted it renders nothing rather than a broken avatar.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

// Resolve a stored avatar path to a deterministic signed URL (the real hook hits
// a query). null/undefined path → no URL, so the initials fallback shows.
vi.mock('@/hooks/useSignedBrandingUrl', () => ({
  useSignedBrandingUrl: (path: string | null | undefined) => ({
    data: path ? `https://signed.example/${path}` : undefined,
  }),
}));

// Radix's AvatarImage only mounts the <img> after the browser loads it, which
// jsdom never does. Render deterministic primitives so photo-vs-initials is
// observable in the DOM.
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  AvatarImage: ({ src, alt = '' }: any) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

// ---------------------------------------------------------------------------
// IdeaDetail composer
// ---------------------------------------------------------------------------

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockFetchIdea = vi.fn();
const mockFetchIdeaComments = vi.fn();
vi.mock('@/lib/ideas-api', () => ({
  fetchIdea: (...args: unknown[]) => mockFetchIdea(...args),
  fetchIdeaComments: (...args: unknown[]) => mockFetchIdeaComments(...args),
  updateIdeaStatus: vi.fn(),
  createIdeaComment: vi.fn(),
  voteForIdea: vi.fn(),
  removeVoteFromIdea: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { community_enabled: true }, isLoading: false }),
}));

import IdeaDetail from '@/pages/community/IdeaDetail';
import { CommentThread } from './CommentThread';

const baseIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'author-uuid',
  title: 'Automate invoice processing',
  status: 'submitted',
  created_at: '2026-01-01T10:00:00.000Z',
  tags: [],
  business_area: null,
  admin_notes: null,
  rejection_reason: null,
  profile: { id: 'author-uuid', full_name: 'Jane Doe' },
  vote_count: 0,
  comment_count: 0,
  user_has_voted: false,
};

// Non-admin viewer named "Test User" (→ initials "TU"). avatarUrl is threaded in
// per test so we can flip the photo-vs-initials fork.
function makeAuth(avatarUrl: string | null) {
  return {
    user: { id: 'oid-entra-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
    profile: {
      id: 'viewer-uuid',
      is_platform_admin: false,
      first_name: 'Test',
      last_name: 'User',
      full_name: 'Test User',
      avatar_url: avatarUrl,
    },
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
}

function renderIdeaDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/community/org/ideas/idea-1']}>
        <Routes>
          <Route path="/app/community/org/ideas/:ideaId" element={<IdeaDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('IdeaDetail composer avatar (#205)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Empty comment list → the only avatar on the page is the composer's.
    mockFetchIdea.mockResolvedValue(baseIdea);
    mockFetchIdeaComments.mockResolvedValue([]);
  });

  it('shows the current user photo when their profile has an avatar_url', async () => {
    mockUseAuth.mockReturnValue(makeAuth('avatars/me.png'));
    const { container } = renderIdeaDetail();

    await screen.findByText('Automate invoice processing');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://signed.example/avatars/me.png');
  });

  it('falls back to initials when the current user has no avatar_url', async () => {
    mockUseAuth.mockReturnValue(makeAuth(null));
    const { container } = renderIdeaDetail();

    await screen.findByText('Automate invoice processing');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('TU')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CommentThread composer
// ---------------------------------------------------------------------------

describe('CommentThread composer avatar (#205)', () => {
  const baseProps = {
    comments: [],
    postId: 'post-1',
    currentUserId: 'viewer-uuid',
    onAddComment: vi.fn(),
  };

  it('shows the current user photo when currentUserAvatarPath is set', () => {
    const { container } = render(
      <CommentThread
        {...baseProps}
        currentUserAvatarPath="avatars/me.png"
        currentUserName="Test User"
      />
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://signed.example/avatars/me.png');
  });

  it('falls back to initials when currentUserAvatarPath is null', () => {
    const { container } = render(
      <CommentThread {...baseProps} currentUserAvatarPath={null} currentUserName="Test User" />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('TU')).toBeInTheDocument();
  });

  it('renders no composer avatar when the current-user props are not passed', () => {
    const { container } = render(<CommentThread {...baseProps} />);
    // The composer itself still renders (currentUserId is present)…
    expect(screen.getByPlaceholderText('community.addCommentPlaceholder')).toBeInTheDocument();
    // …but with no avatar props there is neither a photo nor initials.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('TU')).not.toBeInTheDocument();
  });
});
