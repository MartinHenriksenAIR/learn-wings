import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleCheck, Heart, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LevelBadge } from '@/components/ui/level-badge';
import { routes } from '@/lib/routes';
import { useFavorites, useToggleFavorite } from '@/hooks/useFavorites';
import { FavoriteToggle } from './FavoriteToggle';
import type { ListView } from '@/hooks/useListView';

/**
 * Favorited-courses section for the learner dashboard (#358). Self-contained so
 * #364 can drop it into the future Min Træning page unchanged: it owns its own
 * `useFavorites` read and toggle, renders an <EmptyState> when there are no
 * favorites, and stays silent (renders nothing) until the query resolves so it
 * never flashes the empty state on first load. A favorited course can also be
 * in-progress or completed — this list is that one axis, not deduped against them.
 */
export function FavoriteCourses({
  orgId,
  view = 'card',
}: {
  orgId: string | undefined;
  view?: ListView;
}) {
  const { t } = useTranslation();
  const { data, isFavorite, isLoading } = useFavorites(orgId);
  const { toggleFavorite, togglingId } = useToggleFavorite(orgId);

  // No cached favorites yet — don't flash the empty state before the query lands.
  if (isLoading) return null;

  const courses = data?.courses ?? [];

  return (
    <div className="mb-8">
      <h2 className="mb-3.5 font-display text-[17px] font-bold">{t('training.favorites.title')}</h2>

      {courses.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-6 w-6" />}
          title={t('dashboard.noFavoritesTitle')}
          description={t('dashboard.noFavoritesDescription')}
        />
      ) : (
        <div className={view === 'list' ? 'flex flex-col gap-3' : 'grid gap-3.5 md:grid-cols-2 lg:grid-cols-3'}>
          {courses.map((course) =>
            view === 'list' ? (
              <div
                key={course.id}
                data-testid="training-favorite-row"
                className="hover-lift flex items-center gap-4 rounded-xl border border-border bg-card p-3"
              >
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-primary/80 to-primary">
                  {course.thumbnail_url && (
                    <img
                      src={course.thumbnail_url}
                      alt={course.title}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[14px] font-bold leading-[1.35]">{course.title}</h3>
                    {course.level && <LevelBadge level={course.level} />}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <FavoriteToggle
                    isFavorite={isFavorite(course.id)}
                    pending={togglingId === course.id}
                    onToggle={(next) => toggleFavorite({ courseId: course.id, favorite: next, course })}
                    className="h-8 w-8"
                  />
                  {course.completed ? (
                    <span
                      data-testid="favorite-completed"
                      className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-success/10 px-3 py-2 text-[13px] font-bold text-success"
                    >
                      <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
                      {t('training.mandatory.completed')}
                    </span>
                  ) : (
                    <Button
                      asChild
                      className="h-auto shrink-0 rounded-[10px] bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                    >
                      <Link to={routes.learner.coursePlayer(course.id, 'training')}>
                        <Play aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('courses.openCourse')}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div
                key={course.id}
                className="hover-lift flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="relative h-[110px] bg-gradient-to-br from-primary/80 to-primary">
                  {course.thumbnail_url && (
                    <img
                      src={course.thumbnail_url}
                      alt={course.title}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                  {course.level && <LevelBadge level={course.level} className="absolute bottom-3 left-3.5" />}
                  <FavoriteToggle
                    isFavorite={isFavorite(course.id)}
                    pending={togglingId === course.id}
                    onToggle={(next) => toggleFavorite({ courseId: course.id, favorite: next, course })}
                    className="absolute right-2 top-2 bg-card/90 hover:bg-card"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
                  <h3 className="text-[14.5px] font-bold leading-[1.35]">{course.title}</h3>
                  {course.completed ? (
                    <span
                      data-testid="favorite-completed"
                      className="mt-auto flex items-center justify-center gap-1.5 rounded-[10px] bg-success/10 px-3 py-[9px] text-[13px] font-bold text-success"
                    >
                      <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
                      {t('training.mandatory.completed')}
                    </span>
                  ) : (
                    <Button
                      asChild
                      className="mt-auto h-auto w-full rounded-[10px] bg-accent px-3 py-[9px] text-[13px] font-bold text-accent-foreground hover:bg-[#dfe5f8]"
                    >
                      <Link to={routes.learner.coursePlayer(course.id, 'training')}>
                        <Play aria-hidden="true" className="h-3.5 w-3.5" />
                        {t('courses.openCourse')}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
