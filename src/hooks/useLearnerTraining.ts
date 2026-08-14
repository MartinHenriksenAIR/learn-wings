import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, Enrollment } from '@/lib/types';

type TrainingEnrollment = Enrollment & { course: Course };

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
