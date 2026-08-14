import type { CSSProperties } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { getAvatarColor, getInitials } from '@/lib/utils';

interface BrandingAvatarProps {
  avatarPath: string | null | undefined;
  name?: string | null;
  initialsFallback?: string;
  fallback?: string;
  className?: string;
  fallbackClassName?: string;
  fallbackStyle?: CSSProperties;
}

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
