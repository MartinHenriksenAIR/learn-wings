import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { CourseLevel } from '@/lib/types';

interface OrgCourseProgressResult {
  courses: Array<{
    id: string;
    title: string;
    level: CourseLevel;
    enrolled: number;
    completed: number;
  }>;
}

interface UseOrgCourseProgressOptions {
  /** Gate the fetch. Defaults to true. */
  enabled?: boolean;
  /** Per-observer staleTime override. Defaults to 60s. */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/org-course-progress` from the frontend.
 *
 * Returns the raw courses array; derivations (avgProgress, filtering,
 * grouping) stay at the call site in useMemo.
 */
export function useOrgCourseProgress(
  orgId: string | undefined,
  options: UseOrgCourseProgressOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.orgCourseProgress.detail(orgId),
    queryFn: async () => {
      const data = await callApi<OrgCourseProgressResult>('/api/org-course-progress', { orgId });
      return data;
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
