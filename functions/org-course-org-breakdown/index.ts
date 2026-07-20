import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

/**
 * Per-organization engagement breakdown for a single course, across every org.
 *
 * Powers the "By organization" table in the Global Analytics course dialog when
 * "All Organizations" is selected (#163) — the org dimension that the flat
 * cross-org rollup (#159) sums away. Platform-admin-only (adminEndpoint gates
 * before body parse): the breakdown is inherently cross-org, so an org admin
 * must never reach it.
 *
 * Lists EVERY org that has the course access-enabled, including orgs with zero
 * enrollments (LEFT JOIN → 0/0 "gap" rows) — an adoption signal for platform
 * admins. Counts are org-scoped enrollments; UNIQUE(org_id, user_id, course_id)
 * makes "enrollments within an org" and "distinct learners within an org" equal.
 * Summed across orgs these can exceed the dialog's distinct-learner headline
 * (#159) only when one learner is enrolled in the course through several orgs.
 */
export default adminEndpoint('org-course-org-breakdown', async ({ req, reply }) => {
  const { courseId } = await req.json() as { courseId?: string };

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  const orgs = await query(
    `SELECT o.id AS org_id, o.name AS org_name,
            COUNT(e.id)::int AS enrolled,
            COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
       FROM org_course_access oca
       JOIN organizations o ON o.id = oca.org_id
       LEFT JOIN enrollments e ON e.course_id = oca.course_id AND e.org_id = oca.org_id
      WHERE oca.course_id = $1 AND oca.access = 'enabled'
      GROUP BY o.id, o.name
      ORDER BY enrolled DESC, o.name`,
    [courseId],
  );
  return reply(200, { orgs });
});
