import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ReportedContentDialog } from './ReportedContentDialog';

// t returns the key so we can assert on i18n keys directly
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

// CommentThread passthrough exposing the props the dialog wires in
vi.mock('./CommentThread', () => ({
  CommentThread: (props: {
    comments: { id: string }[];
    readOnly?: boolean;
    highlightedCommentId?: string | null;
  }) => (
    <div
      data-testid="comment-thread"
      data-readonly={String(!!props.readOnly)}
      data-highlighted={props.highlightedCommentId ?? ''}
      data-count={props.comments.length}
    />
  ),
}));

const mockFetchPost = vi.fn();
const mockFetchComments = vi.fn();
vi.mock('@/lib/community-api', () => ({
  fetchPost: (...args: unknown[]) => mockFetchPost(...args),
  fetchComments: (...args: unknown[]) => mockFetchComments(...args),
}));

const post = {
  id: 'post-1',
  scope: 'global',
  org_id: null,
  user_id: 'u1',
  category_id: 'cat',
  title: 'Reported Post Title',
  content: 'the post body',
  tags: [],
  is_pinned: false,
  is_hidden: true,
  is_locked: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  profile: { id: 'u1', full_name: 'Jane Doe' },
};

const comment = {
  id: 'comment-7',
  post_id: 'post-1',
  user_id: 'u2',
  content: 'a bad comment',
  parent_comment_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function renderDialog(report: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportedContentDialog
        open
        onOpenChange={() => {}}
        report={report as never}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockFetchPost.mockReset();
  mockFetchComments.mockReset();
});

describe('ReportedContentDialog (#160)', () => {
  it('shows the post and a read-only thread for a post report', async () => {
    mockFetchPost.mockResolvedValue(post);
    mockFetchComments.mockResolvedValue([comment]);
    renderDialog({ target_type: 'post', target_id: 'post-1', post_id: null });

    await screen.findByText('Reported Post Title');
    expect(screen.getByText('the post body')).toBeInTheDocument();
    expect(mockFetchPost).toHaveBeenCalledWith('post-1');
    const thread = screen.getByTestId('comment-thread');
    expect(thread.dataset.readonly).toBe('true');
    expect(thread.dataset.highlighted).toBe(''); // post reports do not highlight a comment
  });

  it('resolves the parent post and highlights the reported comment for a comment report', async () => {
    mockFetchPost.mockResolvedValue(post);
    mockFetchComments.mockResolvedValue([comment]);
    renderDialog({ target_type: 'comment', target_id: 'comment-7', post_id: 'post-1' });

    await screen.findByText('Reported Post Title');
    expect(mockFetchPost).toHaveBeenCalledWith('post-1');
    const thread = screen.getByTestId('comment-thread');
    expect(thread.dataset.highlighted).toBe('comment-7');
  });

  it('shows a content-unavailable message when the target post is gone', async () => {
    mockFetchPost.mockResolvedValue(null);
    mockFetchComments.mockResolvedValue([]);
    renderDialog({ target_type: 'post', target_id: 'post-1', post_id: null });

    await screen.findByText('moderation.contentUnavailable');
    expect(screen.queryByTestId('comment-thread')).not.toBeInTheDocument();
  });
});
