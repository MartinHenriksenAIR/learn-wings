import { useQuery } from '@tanstack/react-query';
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
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? !!orgId;

  return useQuery({
    queryKey: queryKeys.learnerCourses.list(orgId),
    queryFn: async () => {
      const data = await callApi<{ courses: Course[]; enrollments: Enrollment[] }>(
        '/api/learner-courses',
        { orgId },
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
    enabled,
  });
}
