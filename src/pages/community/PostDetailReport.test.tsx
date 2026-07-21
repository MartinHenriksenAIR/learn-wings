import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock AppLayout as passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- stub heavy child components (ReportDialog stays REAL — it is under test) ---
vi.mock('@/components/community/CategoryBadge', () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));
vi.mock('@/components/community/TagList', () => ({
  TagList: () => <div data-testid="tag-list" />,
}));
vi.mock('@/components/community/CommentThread', () => ({
  CommentThread: () => <div data-testid="comment-thread" />,
}));

// --- mock react-i18next (t returns the key) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// --- mock toast (assertable spy) ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

// --- mock api-client with a real ApiError class so instanceof checks work ---
const { MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return { MockApiError };
});
vi.mock('@/lib/api-client', () => ({
  ApiError: MockApiError,
  callApi: vi.fn(),
  callApiRaw: vi.fn(),
}));

// --- mock the community api ---
const mockFetchPost = vi.fn();
const mockFetchComments = vi.fn();
const mockCreateReport = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPost: (...args: unknown[]) => mockFetchPost(...args),
  fetchComments: (...args: unknown[]) => mockFetchComments(...args),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  createReport: (...args: unknown[]) => mockCreateReport(...args),
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
  title: 'Some Org Post',
  content: 'Some content body',
  created_at: '2026-01-01T10:00:00.000Z',
  is_pinned: false,
  is_locked: false,
  is_hidden: false,
  category: { name: 'General', icon: 'message-square', is_restricted: false, slug: 'general' },
  profile: { id: 'author-uuid', full_name: 'Jane Doe' },
  organization: { id: 'org-1', name: 'Org One' },
  tags: [],
};

const viewerAuth = {
  user: { id: 'oid-entra-1', tid: 'tid-1', email: 'viewer@example.com', name: 'Viewer' },
  profile: { id: 'viewer-uuid', is_platform_admin: false, first_name: 'View', last_name: 'Er' },
  memberships: [],
  currentOrg: { id: 'org-1', name: 'Org One', slug: 'org-one' },
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

function renderPost() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/community/org/posts/post-1']}>
        <Routes>
          <Route path="/app/community/:scope/posts/:postId" element={<PostDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Open the report dialog, pick a reason, and submit.
async function submitReport() {
  fireEvent.click(await screen.findByRole('button', { name: /report/i }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByLabelText('community.reportDialog.reasonSpam'));
  fireEvent.click(screen.getByRole('button', { name: 'community.reportDialog.submit' }));
}

describe('PostDetail — duplicate-report 409 handling (#21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPost.mockResolvedValue(basePost);
    mockFetchComments.mockResolvedValue([]);
    mockUseAuth.mockReturnValue(viewerAuth);
    mockUsePlatformSettings.mockReturnValue({ features: { community_enabled: true }, isLoading: false });
  });

  it('surfaces a 409 as feedback and resolves the dialog (the report already exists)', async () => {
    mockCreateReport.mockRejectedValue(
      new MockApiError('You have already reported this content.', 409),
    );

    renderPost();
    await submitReport();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'community.alreadyReported',
        description: 'community.alreadyReportedDescription',
      }));
    });
    // The dialog resolves — the report already exists, so this outcome is terminal
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // No misleading failure toast for the duplicate case
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('keeps the dialog open with a destructive toast on other errors (500)', async () => {
    mockCreateReport.mockRejectedValue(new MockApiError('Internal server error', 500));

    renderPost();
    await submitReport();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'community.toasts.reportSubmitFailed',
        variant: 'destructive',
      }));
    });
    // Dialog stays open so the user can retry
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog and confirms on success', async () => {
    mockCreateReport.mockResolvedValue({ id: 'r-1' });

    renderPost();
    await submitReport();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'community.toasts.reportSubmitted' }));
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
