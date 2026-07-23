import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseGroupMemberIds } from '../shared/course-groups';

export default endpoint('org-course-enrollees', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const { orgId, courseId } = await req.json() as { orgId?: string; courseId?: string };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  // All-orgs aggregate (Global Analytics "All Organizations", #159) — platform-admin-only.
  // #163: one row per (learner, org) enrollment — NOT deduped — each carrying its org so the
  // dialog can show an Organization column. A learner enrolled in the course through two orgs
  // appears once per org; UNIQUE(org_id, user_id, course_id) caps that at one row per org, so
  // (user_id, org_id) is a stable unique key downstream. Ordered by learner name, then org.
  if (orgId === 'all') {
    requirePlatformAdmin();
    const enrollees = await query(
      `SELECT e.user_id, p.full_name, e.org_id, o.name AS org_name, e.status, e.enrolled_at, e.completed_at
         FROM enrollments e
         JOIN profiles p ON p.id = e.user_id
         JOIN organizations o ON o.id = e.org_id
        WHERE e.course_id IN (${courseGroupMemberIds(1)})
        ORDER BY p.full_name, o.name`,
      [courseId],
    );
    return reply(200, { enrollees });
  }

  await requireOrgAdmin(orgId);

  const enrollees = await query(
    `SELECT e.user_id, p.full_name, e.status, e.enrolled_at, e.completed_at
       FROM enrollments e
       JOIN profiles p ON p.id = e.user_id
      WHERE e.org_id = $1 AND e.course_id IN (${courseGroupMemberIds(2)})
      ORDER BY p.full_name`,
    [orgId, courseId],
  );
  return reply(200, { enrollees });
});
