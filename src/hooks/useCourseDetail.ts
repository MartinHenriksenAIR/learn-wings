import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { LearnerCourseDetail } from '@/lib/types';

export function useCourseDetail(
  orgId: string | undefined,
  courseId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.learnerCourseDetail.detail(orgId, courseId),
    queryFn: async () => {
      const data = await callApi<LearnerCourseDetail>('/api/learner-course-detail', { orgId, courseId });
      return {
        ...data,
        course: {
          ...data.course,
          thumbnail_url: await getSignedLmsAssetUrl(data.course.thumbnail_url),
        },
      };
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId && !!courseId,
  });
}
