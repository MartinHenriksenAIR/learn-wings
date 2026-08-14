import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mockFetchIdea = vi.fn();
const mockFetchIdeaComments = vi.fn();
const mockUpdateIdeaStatus = vi.fn();
const mockCreateIdeaComment = vi.fn();
const mockVoteForIdea = vi.fn();
vi.mock('@/lib/ideas-api', () => ({
  fetchIdea: (...args: unknown[]) => mockFetchIdea(...args),
  fetchIdeaComments: (...args: unknown[]) => mockFetchIdeaComments(...args),
  updateIdeaStatus: (...args: unknown[]) => mockUpdateIdeaStatus(...args),
  createIdeaComment: (...args: unknown[]) => mockCreateIdeaComment(...args),
  voteForIdea: (...args: unknown[]) => mockVoteForIdea(...args),
  removeVoteFromIdea: vi.fn(),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/usePlatformSettings', () => ({
  usePlatformSettings: () => ({ features: { community_enabled: true }, isLoading: false }),
}));

import IdeaDetail from './IdeaDetail';

const baseIdea = {
  id: 'idea-1',
  org_id: 'org-1',
  user_id: 'author-uuid',
  title: 'Automate invoice processing',
  status: 'submitted',
  created_at: '2026-01-01T10:00:00.000Z',
  tags: ['automation'],
  business_area: 'finance',
  admin_notes: null,
  rejection_reason: null,
  profile: { id: 'author-uuid', full_name: 'Jane Doe' },
  vote_count: 3,
  comment_count: 0,
  user_has_voted: false,
};

function makeAuth(effectiveIsOrgAdmin: boolean) {
  return {
    user: { id: 'oid-entra-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
    profile: { id: 'viewer-uuid', is_platform_admin: false, first_name: 'Test', last_name: 'User', full_name: 'Test User' },
    memberships: [{ id: 'm-1', role: effectiveIsOrgAdmin ? 'admin' : 'member', status: 'active' }],
    currentOrg: { id: 'org-1', name: 'Test Org' },
    isPlatformAdmin: false,
    isOrgAdmin: effectiveIsOrgAdmin,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshUserContext: vi.fn(),
    setCurrentOrg: vi.fn(),
    viewMode: 'learner' as const,
    setViewMode: vi.fn(),
    effectiveIsPlatformAdmin: false,
    effectiveIsOrgAdmin,
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

describe('IdeaDetail admin status panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchIdea.mockResolvedValue(baseIdea);
    mockFetchIdeaComments.mockResolvedValue([]);
    mockUpdateIdeaStatus.mockResolvedValue({});
    mockCreateIdeaComment.mockResolvedValue({});
    mockVoteForIdea.mockResolvedValue(undefined);
  });

  it('hides the Update status panel from non-admins', async () => {
    mockUseAuth.mockReturnValue(makeAuth(false));

    renderIdeaDetail();

    await screen.findByText('Automate invoice processing');
    expect(screen.queryByText('community.updateStatus')).not.toBeInTheDocument();
  });

  it('saves the status via the in-button morph (no dialog), then shows the done state', async () => {
    mockUseAuth.mockReturnValue(makeAuth(true));

    renderIdeaDetail();

    await screen.findByText('community.updateStatus');

    const saveButton = screen.getByRole('button', { name: 'common.save' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(mockUpdateIdeaStatus).toHaveBeenCalledTimes(1));
    expect(mockUpdateIdeaStatus).toHaveBeenCalledWith('idea-1', {
      status: 'submitted',
      admin_notes: undefined,
      rejection_reason: undefined,
    });

    const doneButton = await screen.findByRole('button', { name: 'common.saved' });
    expect(doneButton.className).toContain('bg-success');
  });

  it('disables save for a rejected status without a rejection reason (gate preserved)', async () => {
    mockUseAuth.mockReturnValue(makeAuth(true));
    mockFetchIdea.mockResolvedValue({ ...baseIdea, status: 'rejected', rejection_reason: null });

    renderIdeaDetail();

    await screen.findByText('community.updateStatus');

    expect(screen.getByText('community.rejectionReason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('community.rejectionReasonPlaceholder'), {
      target: { value: 'Out of scope' },
    });
    expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled();
  });
});

describe('IdeaDetail vote/comment arguments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchIdea.mockResolvedValue(baseIdea);
    mockFetchIdeaComments.mockResolvedValue([]);
    mockCreateIdeaComment.mockResolvedValue({});
    mockVoteForIdea.mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ ...makeAuth(false), currentOrg: null });
  });

  it('votes with the idea id alone', async () => {
    renderIdeaDetail();

    await screen.findByText('Automate invoice processing');
    fireEvent.click(screen.getByRole('button', { name: '3' }));

    await waitFor(() => expect(mockVoteForIdea).toHaveBeenCalledTimes(1));
    expect(mockVoteForIdea).toHaveBeenCalledWith('idea-1');
  });

  it('comments with the idea id and the trimmed content alone', async () => {
    renderIdeaDetail();

    await screen.findByText('Automate invoice processing');
    fireEvent.change(screen.getByPlaceholderText('community.addCommentPlaceholder'), {
      target: { value: '  Great idea  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'community.comment' }));

    await waitFor(() => expect(mockCreateIdeaComment).toHaveBeenCalledTimes(1));
    expect(mockCreateIdeaComment).toHaveBeenCalledWith('idea-1', 'Great idea');
  });
});
