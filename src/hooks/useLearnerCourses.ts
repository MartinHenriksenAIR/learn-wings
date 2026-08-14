import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, Enrollment } from '@/lib/types';

export function useLearnerCourses(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';

  return useQuery({
    queryKey: [...queryKeys.learnerCourses.list(orgId), lang],
    queryFn: async () => {
      const data = await callApi<{
        courses: Course[];
        enrollments: Enrollment[];
        progress: Record<string, { total: number; completed: number }>;
      }>('/api/learner-courses', { orgId, language: lang });

      const coursesWithFreshThumbnails = await Promise.all(
        data.courses.map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );

      return {
        courses: coursesWithFreshThumbnails,
        enrollments: data.enrollments,
        progress: data.progress,
      };
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
