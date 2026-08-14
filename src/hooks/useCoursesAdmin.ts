import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, OrgCourseAccess } from '@/lib/types';

export interface CoursesAdminData {
  courses: Course[];
  accessRecords: OrgCourseAccess[];
}

interface UseCoursesAdminOptions {
  enabled?: boolean;
  staleTime?: number;
}

export function useCoursesAdmin(options: UseCoursesAdminOptions = {}) {
  return useQuery({
    queryKey: queryKeys.coursesAdmin.all,
    queryFn: async (): Promise<CoursesAdminData> => {
      const adminRes = await callApi<CoursesAdminData>('/api/courses-admin', {});
      const coursesWithFreshThumbnails = await Promise.all(
        adminRes.courses.map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );
      return { courses: coursesWithFreshThumbnails, accessRecords: adminRes.accessRecords };
    },
    enabled: options.enabled ?? true,
    staleTime: options.staleTime,
  });
}
