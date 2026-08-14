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

export function useOrgCourseProgress(orgId: string | undefined, adminLang: string | undefined) {
  return useQuery({
    queryKey: queryKeys.orgCourseProgress.detail(orgId, adminLang),
    queryFn: async () => {
      const data = await callApi<OrgCourseProgressResult>('/api/org-course-progress', { orgId, adminLang });
      return data;
    },
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
