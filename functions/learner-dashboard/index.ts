import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('learner-dashboard', async ({ req, profile, reply, requireActiveMember }) => {
    const { orgId } = await req.json() as { orgId?: unknown };

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    await requireActiveMember(orgId);

    // Step 1: Own enrollments with embedded course
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
      [profile.id, orgId],
    );

    // Step 2: Early exit if no enrollments
    if (enrollments.length === 0) {
      return reply(200, { enrollments: [], progress: {} });
    }

    // Step 3: Batched count queries — no N+1
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
      [profile.id, orgId, courseIds],
    );

    // Step 4: Build progress map — zero-fill for every enrolled course_id
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

    // Step 5: Respond
    return reply(200, { enrollments, progress });
});
