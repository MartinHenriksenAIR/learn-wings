import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FavoriteToggleProps {
  /** Current favorite state — drives the heart fill and the add/remove label. */
  isFavorite: boolean;
  /** Fired with the DESIRED next state; the parent owns the toggle mutation. */
  onToggle: (next: boolean) => void;
  /** Disables the control while a toggle for this course is in flight. */
  pending?: boolean;
  /**
   * `icon` — compact heart-only button for catalog/dashboard cards.
   * `button` — labelled outline button for the course player sidebar.
   */
  variant?: 'icon' | 'button';
  className?: string;
}

/**
 * Presentational heart toggle. It only renders the current favorite state and
 * fires `onToggle(!isFavorite)` — the parent holds `useToggleFavorite` and decides
 * what to do (and which course object to pass for the cache add-patch).
 */
export function FavoriteToggle({
  isFavorite,
  onToggle,
  pending = false,
  variant = 'icon',
  className,
}: FavoriteToggleProps) {
  const { t } = useTranslation();
  const label = isFavorite ? t('courses.removeFromFavorites') : t('courses.addToFavorites');

  // These toggles sit next to card CTAs / links; keep the click from bubbling.
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
          className={cn('mr-2 h-4 w-4', isFavorite && 'fill-current text-primary')}
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
        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-50',
        isFavorite && 'text-primary',
        className,
      )}
    >
      <Heart aria-hidden="true" className={cn('h-[18px] w-[18px]', isFavorite && 'fill-current')} />
    </button>
  );
}
