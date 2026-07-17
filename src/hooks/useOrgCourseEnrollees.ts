import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface OrgCourseEnrolleesResult {
  enrollees: Array<{
    user_id: string;
    full_name: string;
    status: 'enrolled' | 'completed';
    enrolled_at: string;
    completed_at: string | null;
  }>;
}

/**
 * The one way to fetch `/api/org-course-enrollees` from the frontend.
 *
 * Returns the raw enrollees array; the reshape (snake_case → camelCase)
 * stays at the call site in useMemo. Fetch is gated on both orgId and
 * courseId being truthy, so closing the course detail dialog (setting
 * courseId to undefined) disables the query.
 */
export function useOrgCourseEnrollees(orgId: string | undefined, courseId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgCourseEnrollees.detail(orgId, courseId),
    queryFn: async () => {
      const data = await callApi<OrgCourseEnrolleesResult>('/api/org-course-enrollees', {
        orgId,
        courseId,
      });
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !!orgId && !!courseId,
  });
}
