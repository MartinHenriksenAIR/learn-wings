import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-course-enrollees', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const { orgId, courseId } = await req.json() as { orgId?: string; courseId?: string };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  // All-orgs aggregate (Global Analytics "All Organizations", #159) — platform-admin-only.
  // DISTINCT ON (e.user_id) collapses a learner enrolled in the course through several orgs
  // to one row (unique React keys downstream), preferring a completed enrollment; the outer
  // query restores the name ordering the single-org path uses.
  if (orgId === 'all') {
    requirePlatformAdmin();
    const enrollees = await query(
      `SELECT user_id, full_name, status, enrolled_at, completed_at FROM (
         SELECT DISTINCT ON (e.user_id) e.user_id, p.full_name, e.status, e.enrolled_at, e.completed_at
           FROM enrollments e
           JOIN profiles p ON p.id = e.user_id
          WHERE e.course_id = $1
          ORDER BY e.user_id, (e.status = 'completed') DESC, e.enrolled_at ASC
       ) sub
      ORDER BY full_name`,
      [courseId],
    );
    return reply(200, { enrollees });
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
