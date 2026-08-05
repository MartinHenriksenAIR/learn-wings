import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import { useToastMutation } from '@/hooks/useToastMutation';
import type { Course } from '@/lib/types';

interface FavoritesData {
  courses: Course[];
}

export interface ToggleFavoriteInput {
  courseId: string;
  favorite: boolean;
  /**
   * The course being favorited, passed by callers that already hold it (e.g. a
   * catalog card) so the success cache-patch can add it to the list at once.
   * Omit it and the invalidateQueries backstop refetches the authoritative list.
   */
  course?: Course;
}

/**
 * Fetch the learner's favorited courses for `orgId`.
 *
 * The list endpoint returns the same `Course[]` shape as `/api/learner-courses`,
 * so thumbnails are re-signed in the queryFn (mirroring `useLearnerCourses`) and
 * a `favoriteIds` set is derived for O(1) `isFavorite(courseId)` checks by the
 * catalog cards that read this one source alongside the Dashboard section.
 *
 * `enabled` defaults to `!!orgId` — pass it explicitly to gate on the org-guard
 * state (e.g. `enabled: orgGuard === 'ready' && !!currentOrg`).
 */
export function useFavorites(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  const query = useQuery({
    queryKey: queryKeys.favorites.list(orgId),
    queryFn: async () => {
      const data = await callApi<{ courses: Course[] }>('/api/favorites', { orgId });
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

/**
 * Toggle a course's favorite state for `orgId`. Mirrors CoursesManager's
 * `togglePublish` idiom: `useToastMutation` + a `setQueryData` success patch of
 * the favorites cache, plus `invalidateQueries` as a backstop. No `onMutate`
 * optimistic rollback (repo convention — feedback comes from the success patch).
 * `togglingId` exposes the in-flight course id so a button can show a per-course
 * busy state (mirrors `publishingId`).
 */
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
        // Add: patchable only when the caller supplied the course; otherwise the
        // invalidateQueries backstop below refetches the authoritative list.
        if (!course || prev.courses.some((c) => c.id === courseId)) return prev;
        return { ...prev, courses: [...prev.courses, course] };
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
