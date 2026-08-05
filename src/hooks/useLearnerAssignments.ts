import { useQuery } from '@tanstack/react-query';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSignedLmsAssetUrl } from '@/lib/storage';
import type { LearnerAssignment } from '@/lib/types';

/** Raw row shape returned by `/api/learner-assignments` (snake_case). */
interface LearnerAssignmentRow {
  course_id: string;
  course_title: string;
  thumbnail_url: string | null;
  mandatory: boolean;
  due_date: string | null;
  overdue: boolean;
  completed: boolean;
}

/**
 * The learner's own assigned/mandatory courses for `orgId` — the read the
 * Min Træning view (#364) consumes. Thumbnails are signed inside the queryFn so
 * callers always get fresh signed URLs. `enabled` defaults to `!!orgId`.
 */
export function useLearnerAssignments(
  orgId: string | undefined,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.learnerAssignments.list(orgId),
    queryFn: async () => {
      const { assignments } = await callApi<{ assignments: LearnerAssignmentRow[] }>(
        '/api/learner-assignments',
        { orgId },
      );
      const rows = Array.isArray(assignments) ? assignments : [];
      return Promise.all(
        rows.map(async (r): Promise<LearnerAssignment> => ({
          courseId: r.course_id,
          courseTitle: r.course_title,
          thumbnailUrl: await getSignedLmsAssetUrl(r.thumbnail_url),
          mandatory: r.mandatory,
          dueDate: r.due_date,
          overdue: r.overdue,
          completed: r.completed,
          assignedByOrgId: orgId as string,
        })),
      );
    },
    staleTime: options.staleTime ?? 60 * 1000,
    enabled: (options.enabled ?? true) && !!orgId,
  });
}
