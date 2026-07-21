import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PostCard } from './PostCard';
import { CommentItem } from './CommentItem';
import type { CommunityPost, CommunityComment } from '@/lib/community-types';

// #180 — community author avatars. When a profile has an avatar_url, the author
// avatar shows the photo (via the signed branding URL); when null, it falls back
// to coloured initials — no visual regression for photo-less users.

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}));

// Resolve a stored avatar path to a deterministic signed URL (real hook hits a
// query). null/undefined path → no URL, so the fallback initials show.
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

const basePost: CommunityPost = {
  id: 'post-1',
  scope: 'global',
  org_id: null,
  user_id: 'author-1',
  category_id: 'cat-1',
  title: 'Title',
  content: 'Body',
  tags: [],
  is_pinned: false,
  is_hidden: false,
  is_locked: false,
  event_date: null,
  event_location: null,
  event_registration_url: null,
  event_recording_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const baseComment: CommunityComment = {
  id: 'c1',
  post_id: 'post-1',
  user_id: 'author-1',
  content: 'a comment',
  parent_comment_id: null,
  is_hidden: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('community author avatars (#180)', () => {
  it('PostCard shows the author photo when avatar_url is set', () => {
    const post = { ...basePost, profile: { id: 'author-1', full_name: 'Ann Smith', avatar_url: 'avatars/a1.png' } as CommunityPost['profile'] };
    const { container } = render(<PostCard post={post} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://signed.example/avatars/a1.png');
  });

  it('PostCard falls back to initials when avatar_url is null', () => {
    const post = { ...basePost, profile: { id: 'author-1', full_name: 'Ann Smith', avatar_url: null } as CommunityPost['profile'] };
    const { container } = render(<PostCard post={post} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('AS')).toBeInTheDocument();
  });

  it('CommentItem shows the author photo when avatar_url is set', () => {
    const comment = { ...baseComment, profile: { id: 'author-1', full_name: 'Ann Smith', avatar_url: 'avatars/a1.png' } as CommunityComment['profile'] };
    const { container } = render(<CommentItem comment={comment} currentUserId="viewer-1" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://signed.example/avatars/a1.png');
  });

  it('CommentItem falls back to initials when avatar_url is null', () => {
    const comment = { ...baseComment, profile: { id: 'author-1', full_name: 'Ann Smith', avatar_url: null } as CommunityComment['profile'] };
    const { container } = render(<CommentItem comment={comment} currentUserId="viewer-1" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('AS')).toBeInTheDocument();
  });
});
