import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { Course, OrgCourseAccess } from '@/lib/types';

export interface CoursesAdminData {
  /** Courses with thumbnail_url already re-signed for display. */
  courses: Course[];
  accessRecords: OrgCourseAccess[];
}

interface UseCoursesAdminOptions {
  /** Gate the fetch (e.g. until a parent record has loaded). Defaults to true. */
  enabled?: boolean;
  /** Per-observer staleTime override (ms). Defaults to TanStack's 0. */
  staleTime?: number;
}

/**
 * The one way to fetch `/api/courses-admin` — the platform-admin course list
 * plus the org-access matrix — from the frontend.
 *
 * Thumbnails are re-signed for display inside the queryFn, so every consumer of
 * the `['courses-admin']` cache reads the same `{ courses, accessRecords }`
 * shape with display-ready thumbnail URLs. Keeping this a single hook (one
 * queryFn per key) is what prevents two call sites writing divergent shapes
 * under the same key. Site-specific filtering/derivation stays at the call site.
 */
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
