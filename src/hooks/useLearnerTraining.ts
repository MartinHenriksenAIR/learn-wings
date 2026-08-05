import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, Enrollment } from '@/lib/types';

type TrainingEnrollment = Enrollment & { course: Course };

/**
 * Fetch the learner's training data (enrollments + lesson progress) for
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
export function useLearnerTraining(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.learnerTraining.detail(orgId),
    queryFn: async () => {
      const data = await callApi<{
        enrollments: TrainingEnrollment[];
        progress: Record<string, { total: number; completed: number }>;
      }>('/api/learner-training', { orgId });

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
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
