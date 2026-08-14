import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function MicrosoftSignInButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label: ReactNode;
  className?: string;
}) {
  return (
    <Button className={className} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true">
        <rect x="1" y="1" width="10" height="10" fill="#ffffff" />
        <rect x="12" y="1" width="10" height="10" fill="#dfe4f7" />
        <rect x="1" y="12" width="10" height="10" fill="#dfe4f7" />
        <rect x="12" y="12" width="10" height="10" fill="#ffffff" />
      </svg>
      {label}
    </Button>
  );
}
