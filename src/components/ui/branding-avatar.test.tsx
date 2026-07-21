import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandingAvatar } from './branding-avatar';
import { getInitials, getAvatarColor } from '@/lib/utils';

// #201 — BrandingAvatar derives initials + fallback color from an optional `name`
// prop, collapsing the per-site getInitials/getAvatarColor cluster. These tests
// pin that the internal derivation equals the old per-site logic and that any
// explicit prop wins over the derived value.

// Resolve a stored avatar path to a deterministic signed URL (real hook hits a
// query). null/undefined path → no URL, so the fallback initials show.
vi.mock('@/hooks/useSignedBrandingUrl', () => ({
  useSignedBrandingUrl: (path: string | null | undefined) => ({
    data: path ? `https://signed.example/${path}` : undefined,
  }),
}));

// Radix's AvatarImage only mounts the <img> after the browser loads it, which
// jsdom never does. Render deterministic primitives so the fallback content and
// its style are observable in the DOM.
vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: any) => <div className={className}>{children}</div>,
  AvatarImage: ({ src, alt = '' }: any) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children, className, style }: any) => (
    <span data-testid="fallback" className={className} style={style}>
      {children}
    </span>
  ),
}));

describe('BrandingAvatar name-prop derivation (#201)', () => {
  it('derives initials from name, matching getInitials', () => {
    render(<BrandingAvatar avatarPath={null} name="Ann Smith" />);
    expect(screen.getByTestId('fallback')).toHaveTextContent(getInitials('Ann Smith'));
    expect(screen.getByTestId('fallback')).toHaveTextContent('AS');
  });

  it('derives the fallback background color from name, matching getAvatarColor', () => {
    render(<BrandingAvatar avatarPath={null} name="Ann Smith" />);
    expect(screen.getByTestId('fallback')).toHaveStyle({
      backgroundColor: getAvatarColor('Ann Smith'),
    });
  });

  it('uses initialsFallback when name yields no initials', () => {
    render(<BrandingAvatar avatarPath={null} name={null} initialsFallback="??" />);
    expect(screen.getByTestId('fallback')).toHaveTextContent('??');
  });

  it('defaults derived initials to "U" when name is empty and no initialsFallback given', () => {
    render(<BrandingAvatar avatarPath={null} name={undefined} />);
    expect(screen.getByTestId('fallback')).toHaveTextContent(getInitials(undefined));
    expect(screen.getByTestId('fallback')).toHaveTextContent('U');
  });

  it('lets an explicit fallback override the derived initials', () => {
    render(<BrandingAvatar avatarPath={null} name="Ann Smith" fallback="ZZ" />);
    expect(screen.getByTestId('fallback')).toHaveTextContent('ZZ');
  });

  it('lets an explicit fallbackStyle override the derived color', () => {
    render(
      <BrandingAvatar
        avatarPath={null}
        name="Ann Smith"
        fallbackStyle={{ backgroundColor: 'rgb(1, 2, 3)' }}
      />,
    );
    expect(screen.getByTestId('fallback')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
  });

  it('still resolves a photo from avatarPath when a name is supplied', () => {
    const { container } = render(<BrandingAvatar avatarPath="avatars/a1.png" name="Ann Smith" />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://signed.example/avatars/a1.png',
    );
  });

  it('remains valid with only an explicit fallback (no name) — existing usage', () => {
    render(<BrandingAvatar avatarPath={null} fallback="AB" />);
    expect(screen.getByTestId('fallback')).toHaveTextContent('AB');
  });
});
