import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentThread } from './CommentThread';
import type { CommunityComment } from '@/lib/community-types';

// t returns the key so we can assert on i18n keys directly
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

// CommentItem passthrough that reveals whether the reply affordance was wired
vi.mock('./CommentItem', () => ({
  CommentItem: ({ comment, onReply }: { comment: CommunityComment; onReply?: unknown }) => (
    <div data-testid="comment-item">
      <span>{comment.content}</span>
      {onReply ? <span data-testid="reply-enabled" /> : null}
    </div>
  ),
}));

const comment: CommunityComment = {
  id: 'c1',
  post_id: 'p1',
  user_id: 'u1',
  content: 'a reported comment',
  parent_comment_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const baseProps = {
  comments: [comment],
  postId: 'p1',
  onAddComment: vi.fn(),
};

describe('CommentThread readOnly (#160)', () => {
  it('shows the composer and reply affordance in the default (editable) mode', () => {
    render(<CommentThread {...baseProps} currentUserId="u1" />);
    expect(screen.getByPlaceholderText('community.addCommentPlaceholder')).toBeInTheDocument();
    expect(screen.getByTestId('reply-enabled')).toBeInTheDocument();
  });

  it('hides the composer, reply, and locked banner in read-only mode', () => {
    render(<CommentThread {...baseProps} currentUserId="u1" isLocked readOnly />);
    expect(screen.queryByPlaceholderText('community.addCommentPlaceholder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reply-enabled')).not.toBeInTheDocument();
    expect(screen.queryByText('community.commentsLocked')).not.toBeInTheDocument();
    // the comment itself is still rendered for reading
    expect(screen.getByText('a reported comment')).toBeInTheDocument();
  });
});
