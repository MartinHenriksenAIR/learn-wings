import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled } from '../shared/course-visibility';

export default endpoint('org-course-progress', async ({ req, reply, requireOrgAdmin, requirePlatformAdmin }) => {
  const { orgId } = await req.json() as { orgId?: string };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  // All-orgs aggregate (Global Analytics "All Organizations", #159) — platform-admin-only.
  // COUNT(DISTINCT e.user_id): one learner enrolled in the same course via two orgs counts
  // once, matching the single-org semantics (UNIQUE(org,user,course) makes them equal there).
  if (orgId === 'all') {
    requirePlatformAdmin();
    const courses = await query(
      `SELECT c.id, c.title, c.level,
              COUNT(DISTINCT e.user_id)::int AS enrolled,
              COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'completed')::int AS completed
         FROM courses c
         LEFT JOIN enrollments e ON e.course_id = c.id
        WHERE EXISTS (SELECT 1 FROM org_course_access oca
                       WHERE oca.course_id = c.id AND oca.access = 'enabled')
        GROUP BY c.id, c.title, c.level
        ORDER BY c.title`,
    );
    return reply(200, { courses });
  }

  await requireOrgAdmin(orgId);

  // ONE rollup query — DELIBERATELY no is_published filter (parity: pre-migration UI showed all
  // enabled-access courses regardless of publish state), hence the access-only shared fragment.
  // Equivalent to the old FROM org_course_access JOIN courses form — UNIQUE(org_id, course_id)
  // on org_course_access guarantees one access row per course per org.
  const courses = await query(
    `SELECT c.id, c.title, c.level,
            COUNT(e.id)::int AS enrolled,
            COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id = c.id AND e.org_id = $1
      WHERE ${orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })}
      GROUP BY c.id, c.title, c.level
      ORDER BY c.title`,
    [orgId],
  );
  return reply(200, { courses });
});
