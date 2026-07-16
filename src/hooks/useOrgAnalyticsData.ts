import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface OrgAnalyticsDataResult {
  members: Array<{ user_id: string; full_name: string; email: string; department?: string }>;
  enrollments: Array<{ user_id: string; status: string; course_id: string }>;
  quizAttempts: Array<{ user_id: string; score: number }>;
}

/**
 * The one way to fetch `/api/org-analytics-data` from the frontend.
 *
 * All consumers sharing the same orgId share one TanStack Query cache entry,
 * so multiple mounts produce one network request. Site-specific derivations
 * (stats, userStats, departments) stay at the call site in useMemo.
 */
export function useOrgAnalyticsData(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgAnalyticsData.detail(orgId),
    queryFn: async () => {
      const data = await callApi<OrgAnalyticsDataResult>('/api/org-analytics-data', { orgId });
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
