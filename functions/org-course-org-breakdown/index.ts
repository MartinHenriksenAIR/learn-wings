import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { courseGroupMemberIds } from '../shared/course-groups';

export default adminEndpoint('org-course-org-breakdown', async ({ req, reply }) => {
  const { courseId } = await req.json() as { courseId?: string };

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  const orgs = await query(
    `WITH grp AS (${courseGroupMemberIds(1)})
     SELECT o.id AS org_id, o.name AS org_name,
            COUNT(DISTINCT e.user_id)::int AS enrolled,
            COUNT(DISTINCT e.user_id) FILTER (WHERE e.status = 'completed')::int AS completed
       FROM organizations o
       JOIN (
         SELECT oca.org_id FROM org_course_access oca
          WHERE oca.course_id IN (SELECT id FROM grp) AND oca.access = 'enabled'
         UNION
         SELECT e.org_id FROM enrollments e WHERE e.course_id IN (SELECT id FROM grp)
       ) rel ON rel.org_id = o.id
       LEFT JOIN enrollments e ON e.course_id IN (SELECT id FROM grp) AND e.org_id = o.id
      -- #354: solo learners enroll under the hidden Individuals placeholder org, so the
      -- enrollment UNION above would otherwise surface it as a named org row here — even
      -- to platform admins. Exclude only the individual tier; future paid tiers stay in.
      WHERE o.kind <> 'individual'
      GROUP BY o.id, o.name
      ORDER BY enrolled DESC, o.name`,
    [courseId],
  );
  return reply(200, { orgs });
});
