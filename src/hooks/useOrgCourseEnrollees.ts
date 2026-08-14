import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface OrgCourseEnrolleesResult {
  enrollees: Array<{
    user_id: string;
    full_name: string;
    org_id?: string;
    org_name?: string;
    status: 'enrolled' | 'completed';
    enrolled_at: string;
    completed_at: string | null;
  }>;
}

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
