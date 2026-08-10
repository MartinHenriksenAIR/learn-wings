import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { LearnerCourseDetail } from '@/lib/types';

/**
 * Fetch the read-only "read about a course" detail for `courseId` in `orgId`
 * (#403) — course fields, the module outline (title + lesson count), and the
 * caller's own enrollment status (drives the state-aware CTA). Unlike the
 * player's endpoint this NEVER enrolls the learner.
 *
 * The thumbnail is re-signed in the queryFn (mirroring useLearnerCourses) so the
 * page always receives a fresh signed URL with no post-fetch state management.
 * `enabled` defaults to `!!orgId && !!courseId` — pass it explicitly to also gate
 * on the org-guard state (e.g. `enabled: orgGuard === 'ready' && !!currentOrg`).
 */
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
