import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface OrgAnalyticsMember {
  user_id: string;
  full_name: string;
  email: string;
  department?: string;
  /** Role of this member in the org. 'learner' | 'org_admin'; null for edge cases. */
  role?: 'learner' | 'org_admin' | null;
  /** AI level from the onboarding assessment. null = not yet assessed. */
  assessment_level?: 'basic' | 'intermediate' | 'advanced' | null;
}

export interface OrgAnalyticsDataResult {
  members: OrgAnalyticsMember[];
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
