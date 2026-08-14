import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export interface OrgAnalyticsMember {
  user_id: string;
  full_name: string;
  email: string;
  department?: string;
  role?: 'learner' | 'org_admin' | null;
  assessment_level?: 'basic' | 'intermediate' | 'advanced' | null;
}

export interface OrgAnalyticsDataResult {
  members: OrgAnalyticsMember[];
  enrollments: Array<{ user_id: string; status: string; course_id: string }>;
  quizAttempts: Array<{ user_id: string; score: number }>;
}

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
