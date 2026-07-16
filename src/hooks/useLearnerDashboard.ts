import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, Enrollment } from '@/lib/types';

type DashboardEnrollment = Enrollment & { course: Course };

/**
 * Fetch the learner's dashboard data (enrollments + lesson progress) for
 * `orgId`, with thumbnail signing baked in.
 *
 * Returns:
 *  - `enrollments` — enriched with a required `course` shape (as the API returns)
 *  - `progress`    — map of courseId → { total, completed }
 *  - `thumbnailUrls` — map of courseId → signed thumbnail URL
 *
 * `enabled` defaults to `!!orgId` — pass it explicitly to gate on the
 * org-guard state (e.g. `enabled: orgGuard === 'ready' && !!currentOrg`).
 */
export function useLearnerDashboard(
  orgId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? !!orgId;

  return useQuery({
    queryKey: queryKeys.learnerDashboard.detail(orgId),
    queryFn: async () => {
      const data = await callApi<{
        enrollments: DashboardEnrollment[];
        progress: Record<string, { total: number; completed: number }>;
      }>('/api/learner-dashboard', { orgId });

      // Resolve thumbnail signed URLs, keyed by course_id
      const thumbMap: Record<string, string> = {};
      await Promise.all(
        data.enrollments.map(async (e) => {
          if (e.course?.thumbnail_url) {
            const url = await getSignedLmsAssetUrl(e.course.thumbnail_url);
            if (url) thumbMap[e.course_id] = url;
          }
        }),
      );

      return {
        enrollments: data.enrollments,
        progress: data.progress,
        thumbnailUrls: thumbMap,
      };
    },
    enabled,
  });
}
