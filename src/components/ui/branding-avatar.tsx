import type { CSSProperties } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { getAvatarColor, getInitials } from '@/lib/utils';

interface BrandingAvatarProps {
  /** Stored container-relative avatar path (e.g. `avatars/<uuid>.png`), or null. */
  avatarPath: string | null | undefined;
  /**
   * Display name used to derive the fallback initials and background color when
   * the explicit `fallback` / `fallbackStyle` props are omitted. Explicit props
   * always win over the derived values.
   */
  name?: string | null;
  /** Fallback initials shown when `name` yields none (passed to getInitials). */
  initialsFallback?: string;
  /**
   * Initials/fallback content shown while signing, on failure, or when no photo.
   * Overrides the value derived from `name`.
   */
  fallback?: string;
  className?: string;
  fallbackClassName?: string;
  /** Overrides the background color derived from `name`. */
  fallbackStyle?: CSSProperties;
}

/**
 * Avatar that resolves a stored branding path to a short-lived signed URL for
 * display (via useSignedBrandingUrl). Falls back to initials until/unless a
 * signed URL is available. Use in lists — each instance signs its own path,
 * deduped/cached per path by TanStack Query.
 *
 * Pass `name` to derive the initials + deterministic fallback color internally
 * (via getInitials/getAvatarColor); pass `fallback`/`fallbackStyle` to override
 * either derived value.
 */
export function BrandingAvatar({
  avatarPath,
  name,
  initialsFallback,
  fallback,
  className,
  fallbackClassName,
  fallbackStyle,
}: BrandingAvatarProps) {
  const { data: src } = useSignedBrandingUrl(avatarPath);
  const content = fallback ?? getInitials(name, initialsFallback);
  const style = fallbackStyle ?? { backgroundColor: getAvatarColor(name) };
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className={fallbackClassName} style={style}>
        {content}
      </AvatarFallback>
    </Avatar>
  );
}
