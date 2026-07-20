import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentItem } from './CommentItem';
import type { CommunityComment } from '@/lib/community-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

const comment: CommunityComment = {
  id: 'c1',
  post_id: 'p1',
  user_id: 'author-1',
  content: 'a comment',
  parent_comment_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  profile: { id: 'author-1', full_name: 'Author' } as CommunityComment['profile'],
};

describe('CommentItem actions menu (#160)', () => {
  it('renders the actions trigger when at least one action is available', () => {
    // viewer is not the author, so Report is available
    render(<CommentItem comment={comment} currentUserId="viewer-1" onReport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'common.actions' })).toBeInTheDocument();
  });

  it('hides the actions trigger entirely when no actions are available (read-only)', () => {
    render(<CommentItem comment={comment} currentUserId="viewer-1" />);
    expect(screen.queryByRole('button', { name: 'common.actions' })).not.toBeInTheDocument();
  });
});
