import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import { useToastMutation } from '@/hooks/useToastMutation';
import type { Course, FavoriteCourse } from '@/lib/types';

interface FavoritesData {
  courses: FavoriteCourse[];
}

export interface ToggleFavoriteInput {
  courseId: string;
  favorite: boolean;
  course?: Course;
}

export function useFavorites(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  const query = useQuery({
    queryKey: queryKeys.favorites.list(orgId),
    queryFn: async () => {
      const data = await callApi<{ courses: FavoriteCourse[] }>('/api/favorites', { orgId });
      const courses = Array.isArray(data.courses) ? data.courses : [];

      const coursesWithFreshThumbnails = await Promise.all(
        courses.map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );

      return { courses: coursesWithFreshThumbnails };
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });

  const favoriteIds = useMemo(
    () => new Set((query.data?.courses ?? []).map((c) => c.id)),
    [query.data],
  );

  const isFavorite = useCallback(
    (courseId: string) => favoriteIds.has(courseId),
    [favoriteIds],
  );

  return { ...query, favoriteIds, isFavorite };
}

export function useToggleFavorite(orgId: string | undefined) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const mutation = useToastMutation({
    mutationFn: ({ courseId, favorite }: ToggleFavoriteInput) =>
      callApi<{ favorited: boolean }>('/api/favorite-set', { orgId, courseId, favorite }),
    errorTitle: t('favorites.toggleFailed'),
    onSuccess: (_data, { courseId, favorite, course }) => {
      queryClient.setQueryData<FavoritesData>(queryKeys.favorites.list(orgId), (prev) => {
        if (!prev) return prev;
        if (!favorite) {
          return { ...prev, courses: prev.courses.filter((c) => c.id !== courseId) };
        }
        if (!course || prev.courses.some((c) => c.id === courseId)) return prev;
        return { ...prev, courses: [{ ...course, completed: false }, ...prev.courses] };
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.favorites.list(orgId) });
    },
    onSettled: () => setTogglingId(null),
  });

  const toggleFavorite = (input: ToggleFavoriteInput) => {
    setTogglingId(input.courseId);
    mutation.mutate(input);
  };

  return { toggleFavorite, togglingId, isPending: mutation.isPending };
}
