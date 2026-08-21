import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavoriteToggleProps {
  isFavorite: boolean;
  onToggle: (next: boolean) => void;
  pending?: boolean;
  variant?: 'icon' | 'button';
  className?: string;
}

export function FavoriteToggle({
  isFavorite,
  onToggle,
  pending = false,
  variant = 'icon',
  className,
}: FavoriteToggleProps) {
  const { t } = useTranslation();
  const label = isFavorite ? t('courses.removeFromFavorites') : t('courses.addToFavorites');

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle(!isFavorite);
  };

  if (variant === 'button') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        aria-pressed={isFavorite}
        disabled={pending}
        onClick={handleClick}
        className={cn('rounded-[10px] text-[12.5px] font-bold', className)}
      >
        <Heart
          aria-hidden="true"
          className={cn('mr-2 h-4 w-4', isFavorite && 'fill-current text-legacy-primary')}
        />
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isFavorite}
      disabled={pending}
      onClick={handleClick}
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-legacy-muted-foreground transition-colors hover:bg-legacy-muted hover:text-legacy-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-legacy-ring disabled:opacity-50',
        isFavorite && 'text-legacy-primary',
        className,
      )}
    >
      <Heart aria-hidden="true" className={cn('h-[18px] w-[18px]', isFavorite && 'fill-current')} />
    </button>
  );
}
