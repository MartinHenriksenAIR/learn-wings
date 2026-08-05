import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { CourseCategory } from '@/lib/types';

interface UseCourseCategoriesOptions {
  /** Gate the fetch (e.g. platform admins only). Defaults to true. */
  enabled?: boolean;
  /**
   * Per-observer staleTime override. Defaults to 60s — the category list rarely
   * changes mid-session, so consumers mounting within a minute share one fetch.
   */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/course-categories` from the frontend.
 *
 * All consumers share the `['course-categories']` TanStack Query cache entry, so
 * the editor and the management tab mounting in sequence produce one network
 * request instead of one each. The server returns rows already ordered by
 * `sort_order`; label-language selection stays at the call site.
 */
export function useCourseCategories(options: UseCourseCategoriesOptions = {}) {
  return useQuery({
    queryKey: queryKeys.courseCategories.all,
    queryFn: async () => {
      const { categories } = await callApi<{ categories: CourseCategory[] }>(
        '/api/course-categories',
        {},
      );
      return Array.isArray(categories) ? categories : [];
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: options.enabled ?? true,
  });
}
