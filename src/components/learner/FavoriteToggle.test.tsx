import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

import { FavoriteToggle } from './FavoriteToggle';

describe('FavoriteToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the add-to-favorites label and an outline heart when not favorited', () => {
    render(<FavoriteToggle isFavorite={false} onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'courses.addToFavorites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('.fill-current')).toBeNull();
  });

  it('renders the remove-from-favorites label and a filled heart when favorited', () => {
    render(<FavoriteToggle isFavorite onToggle={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'courses.removeFromFavorites' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.querySelector('.fill-current')).not.toBeNull();
  });

  it('fires onToggle with the desired next state (true when adding)', () => {
    const onToggle = vi.fn();
    render(<FavoriteToggle isFavorite={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'courses.addToFavorites' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('fires onToggle with the desired next state (false when removing)', () => {
    const onToggle = vi.fn();
    render(<FavoriteToggle isFavorite onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: 'courses.removeFromFavorites' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('disables the control and does not fire onToggle while pending', () => {
    const onToggle = vi.fn();
    render(<FavoriteToggle isFavorite={false} onToggle={onToggle} pending />);

    const button = screen.getByRole('button', { name: 'courses.addToFavorites' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('renders the visible label text in the button variant', () => {
    render(<FavoriteToggle variant="button" isFavorite={false} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'courses.addToFavorites' })).toHaveTextContent(
      'courses.addToFavorites',
    );
  });
});
