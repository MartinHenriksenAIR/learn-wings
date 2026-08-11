import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockUseFavorites = vi.fn();
const mockUseToggleFavorite = vi.fn();
vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: (...args: unknown[]) => mockUseFavorites(...args),
  useToggleFavorite: (...args: unknown[]) => mockUseToggleFavorite(...args),
}));

import { FavoriteCourses } from './FavoriteCourses';

const course = {
  id: 'c-1', title: 'Intro to AI', description: 'Learn the basics', level: 'basic',
  language: 'en', course_group_id: null, is_published: true, thumbnail_url: null,
  created_by_user_id: null, created_at: '2026-01-01T00:00:00Z',
};

function renderSection() {
  return render(
    <MemoryRouter>
      <FavoriteCourses orgId="org-1" />
    </MemoryRouter>,
  );
}

describe('FavoriteCourses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseToggleFavorite.mockReturnValue({ toggleFavorite: vi.fn(), togglingId: null, isPending: false });
  });

  it('renders a card per favorited course with a link into the player', () => {
    mockUseFavorites.mockReturnValue({
      data: { courses: [course] },
      isFavorite: (id: string) => id === 'c-1',
      isLoading: false,
    });

    renderSection();

    expect(screen.getByText('training.favorites.title')).toBeInTheDocument();
    expect(screen.getByText('Intro to AI')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /courses\.openCourse/ })).toHaveAttribute('href', '/app/learn/c-1');
    // No empty state when there are favorites.
    expect(screen.queryByText('dashboard.noFavoritesTitle')).toBeNull();
  });

  it('renders the empty state when there are no favorites', () => {
    mockUseFavorites.mockReturnValue({
      data: { courses: [] },
      isFavorite: () => false,
      isLoading: false,
    });

    renderSection();

    expect(screen.getByText('training.favorites.title')).toBeInTheDocument();
    expect(screen.getByText('dashboard.noFavoritesTitle')).toBeInTheDocument();
    expect(screen.getByText('dashboard.noFavoritesDescription')).toBeInTheDocument();
  });

  it('renders nothing while the favorites query is still loading', () => {
    mockUseFavorites.mockReturnValue({ data: undefined, isFavorite: () => false, isLoading: true });

    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('training.favorites.title')).toBeNull();
    expect(screen.queryByText('dashboard.noFavoritesTitle')).toBeNull();
  });

  it('unfavorites a course from its card, passing favorite:false', () => {
    const toggleFavorite = vi.fn();
    mockUseFavorites.mockReturnValue({
      data: { courses: [course] },
      isFavorite: (id: string) => id === 'c-1',
      isLoading: false,
    });
    mockUseToggleFavorite.mockReturnValue({ toggleFavorite, togglingId: null, isPending: false });

    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'courses.removeFromFavorites' }));
    expect(toggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c-1', favorite: false }));
  });
});
