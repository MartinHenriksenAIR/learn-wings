import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface OrgCourseOrgBreakdownResult {
  orgs: Array<{
    org_id: string;
    org_name: string;
    enrolled: number;
    completed: number;
  }>;
}

export function useOrgCourseOrgBreakdown(courseId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgCourseOrgBreakdown.detail(courseId),
    queryFn: async () => {
      const data = await callApi<OrgCourseOrgBreakdownResult>('/api/org-course-org-breakdown', {
        courseId,
      });
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !!courseId,
  });
}
