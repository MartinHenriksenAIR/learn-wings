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

/**
 * The one way to fetch `/api/org-course-org-breakdown` from the frontend.
 *
 * Per-org engagement for a single course across every org that has it enabled
 * (#163) — the "By organization" table in the all-orgs course dialog. Returns
 * the raw orgs array; derivation (completion rate, snake_case → camelCase)
 * stays at the call site in useMemo. Gated on courseId, so closing the dialog
 * (courseId → undefined) disables the query. Platform-admin-only server-side.
 */
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
