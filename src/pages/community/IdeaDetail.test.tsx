import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock AppLayout as passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock react-i18next (t returns the key) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// --- mock sonner toast ---
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// --- mock the ideas api ---
const mockFetchIdea = vi.fn();
const mockFetchIdeaComments = vi.fn();
const mockUpdateIdeaStatus = vi.fn();
vi.mock('@/lib/ideas-api', () => ({
  fetchIdea: (...args: unknown[]) => mockFetchIdea(...args),
  fetchIdeaComments: (...args: unknown[]) => mockFetchIdeaComments(...args),
  updateIdeaStatus: (...args: unknown[]) => mockUpdateIdeaStatus(...args),
  createIdeaComment: vi.fn(),
  voteForIdea: vi.fn(),
  removeVoteFromIdea: vi.fn(),
}));

// --- configurable hook mocks ---
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

    // In-button success feedback: the button morphs to the green done state.
    const doneButton = await screen.findByRole('button', { name: 'common.saved' });
    expect(doneButton.className).toContain('bg-success');
  });

  it('disables save for a rejected status without a rejection reason (gate preserved)', async () => {
    mockUseAuth.mockReturnValue(makeAuth(true));
    mockFetchIdea.mockResolvedValue({ ...baseIdea, status: 'rejected', rejection_reason: null });

    renderIdeaDetail();

    await screen.findByText('community.updateStatus');

    // Panel seeded from the idea: status=rejected, empty reason → save gated off.
    expect(screen.getByText('community.rejectionReason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();

    // Providing a reason re-enables the save.
    fireEvent.change(screen.getByPlaceholderText('community.rejectionReasonPlaceholder'), {
      target: { value: 'Out of scope' },
    });
    expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled();
  });
});
