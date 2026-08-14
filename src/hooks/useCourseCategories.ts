import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { CourseCategory } from '@/lib/types';

interface UseCourseCategoriesOptions {
  enabled?: boolean;
  staleTime?: number;
}

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
