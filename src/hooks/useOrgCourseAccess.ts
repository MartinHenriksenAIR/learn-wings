import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { AssignableCourse, Course } from '@/lib/types';

interface AccessRow {
  id: string;
  course_id: string;
  access: string;
  course: Course;
}

export function useOrgCourseAccess(orgId: string | undefined) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'en';

  return useQuery({
    queryKey: [...queryKeys.orgCourseAccess.list(orgId), lang],
    queryFn: async () => {
      const { access } = await callApi<{ access: AccessRow[] }>(
        '/api/org-course-access',
        { orgId, language: lang },
      );
      const rows = Array.isArray(access) ? access : [];
      return rows
        .filter((r) => r.access === 'enabled' && r.course?.is_published === true)
        .map((r): AssignableCourse => ({
          id: r.course.id,
          title: r.course.title,
          language: r.course.language,
        }));
    },
    staleTime: 60 * 1000,
    enabled: !!orgId,
  });
}
