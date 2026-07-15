import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-course-enrollees', async ({ req, reply, requireOrgAdmin }) => {
    const { orgId, courseId } = await req.json() as { orgId?: string; courseId?: string };

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }
    if (!courseId || typeof courseId !== 'string') {
      return reply(400, { error: 'courseId is required' });
    }

    await requireOrgAdmin(orgId);

    const enrollees = await query(
      `SELECT e.user_id, p.full_name, e.status, e.enrolled_at, e.completed_at
         FROM enrollments e
         JOIN profiles p ON p.id = e.user_id
        WHERE e.org_id = $1 AND e.course_id = $2
        ORDER BY p.full_name`,
      [orgId, courseId],
    );
    return reply(200, { enrollees });
});
