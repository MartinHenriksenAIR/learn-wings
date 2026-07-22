import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, Enrollment } from '@/lib/types';

/**
 * Fetch the learner's course catalogue + enrolment list for `orgId`.
 *
 * Thumbnail signing happens inside the queryFn so callers always receive
 * fresh signed URLs without any post-fetch state management.
 * `enabled` defaults to `!!orgId` — pass it explicitly to gate on the
 * org-guard state (e.g. `enabled: orgGuard === 'ready' && !!currentOrg`).
 */
export function useLearnerCourses(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'da';

  return useQuery({
    queryKey: [...queryKeys.learnerCourses.list(orgId), lang],
    queryFn: async () => {
      const data = await callApi<{ courses: Course[]; enrollments: Enrollment[] }>(
        '/api/learner-courses',
        { orgId, language: lang },
      );

      const coursesWithFreshThumbnails = await Promise.all(
        data.courses.map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );

      return {
        courses: coursesWithFreshThumbnails,
        enrollments: data.enrollments,
      };
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
