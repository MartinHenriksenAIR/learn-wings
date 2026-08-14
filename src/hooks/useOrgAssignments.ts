import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { OrgAssignment } from '@/lib/types';

interface OrgAssignmentRow {
  id: string;
  org_id: string;
  course_id: string;
  course_title: string;
  user_id: string | null;
  user_full_name: string | null;
  mandatory: boolean;
  due_date: string | null;
  assigned_by_user_id: string | null;
  assigned_by_name: string | null;
  created_at: string;
}

export function useOrgAssignments(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.assignments.list(orgId),
    queryFn: async () => {
      const { assignments } = await callApi<{ assignments: OrgAssignmentRow[] }>(
        '/api/assignments',
        { orgId },
      );
      const rows = Array.isArray(assignments) ? assignments : [];
      return rows.map((r): OrgAssignment => ({
        id: r.id,
        orgId: r.org_id,
        courseId: r.course_id,
        courseTitle: r.course_title,
        userId: r.user_id,
        userFullName: r.user_full_name,
        mandatory: r.mandatory,
        dueDate: r.due_date,
        assignedByUserId: r.assigned_by_user_id,
        assignedByName: r.assigned_by_name,
        createdAt: r.created_at,
      }));
    },
    staleTime: 30 * 1000,
    enabled: !!orgId,
  });
}
