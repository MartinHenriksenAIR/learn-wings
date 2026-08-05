import { query } from '../shared/db';

/**
 * Shared enrollment + per-course progress query for a learner in one org.
 *
 * Single source of truth for the aggregate SQL behind the learner dashboard and
 * the "Min Træning" training page — both endpoints return `{ enrollments,
 * progress }` from here, so the SQL (query order, text, params) lives once.
 *
 * `progress` is a zero-filled map keyed by course id: every enrolled course is
 * present, with `{ total, completed }` lesson counts (0 when a course has no
 * lessons or the learner has no completed lessons).
 */
export async function getLearnerProgress(
  profileId: string,
  orgId: string,
): Promise<{ enrollments: unknown[]; progress: Record<string, { total: number; completed: number }> }> {
  const enrollments = await query(
    `SELECT e.id, e.org_id, e.user_id, e.course_id, e.status, e.enrolled_at, e.completed_at,
            json_build_object(
              'id', c.id, 'title', c.title, 'description', c.description, 'level', c.level,
              'is_published', c.is_published, 'thumbnail_url', c.thumbnail_url,
              'created_by_user_id', c.created_by_user_id, 'created_at', c.created_at
            ) AS course
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = $1 AND e.org_id = $2
      ORDER BY e.enrolled_at DESC`,
    [profileId, orgId],
  );

  if (enrollments.length === 0) {
    return { enrollments: [], progress: {} };
  }

  // Batched count queries — no N+1
  const courseIds = enrollments.map((e) => (e as { course_id: string }).course_id);

  const totalsRows = await query<{ course_id: string; total: number }>(
    `SELECT cm.course_id, COUNT(l.id)::int AS total
       FROM course_modules cm
       JOIN lessons l ON l.module_id = cm.id
      WHERE cm.course_id = ANY($1::uuid[])
      GROUP BY cm.course_id`,
    [courseIds],
  );

  const completedRows = await query<{ course_id: string; completed: number }>(
    `SELECT cm.course_id, COUNT(*)::int AS completed
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN course_modules cm ON cm.id = l.module_id
      WHERE lp.user_id = $1 AND lp.org_id = $2 AND lp.status = 'completed'
        AND cm.course_id = ANY($3::uuid[])
      GROUP BY cm.course_id`,
    [profileId, orgId, courseIds],
  );

  const totalsMap = new Map<string, number>();
  for (const row of totalsRows) {
    totalsMap.set(row.course_id, row.total);
  }

  const completedMap = new Map<string, number>();
  for (const row of completedRows) {
    completedMap.set(row.course_id, row.completed);
  }

  const progress: Record<string, { total: number; completed: number }> = {};
  for (const courseId of courseIds) {
    progress[courseId] = {
      total: totalsMap.get(courseId) ?? 0,
      completed: completedMap.get(courseId) ?? 0,
    };
  }

  return { enrollments, progress };
}
