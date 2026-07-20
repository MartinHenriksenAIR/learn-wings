import type { CSSProperties } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';

interface BrandingAvatarProps {
  /** Stored container-relative avatar path (e.g. `avatars/<uuid>.png`), or null. */
  avatarPath: string | null | undefined;
  /** Initials/fallback content shown while signing, on failure, or when no photo. */
  fallback: string;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
}

/**
 * Avatar that resolves a stored branding path to a short-lived signed URL for
 * display (via useSignedBrandingUrl). Falls back to initials until/unless a
 * signed URL is available. Use in lists — each instance signs its own path,
 * deduped/cached per path by TanStack Query.
 */
export function BrandingAvatar({ avatarPath, fallback, className, fallbackClassName, fallbackStyle }: BrandingAvatarProps) {
  const { data: src } = useSignedBrandingUrl(avatarPath);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className={fallbackClassName} style={fallbackStyle}>
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}
