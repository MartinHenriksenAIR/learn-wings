import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';
import { courseGroupMemberIds } from '../shared/course-groups';

/**
 * Per-organization engagement breakdown for a single course, across every org.
 *
 * Powers the "By organization" table in the Global Analytics course dialog when
 * "All Organizations" is selected (#163) — the org dimension that the flat
 * cross-org rollup (#159) sums away. Platform-admin-only (adminEndpoint gates
 * before body parse): the breakdown is inherently cross-org, so an org admin
 * must never reach it.
 *
 * Org population = orgs with the course access-enabled UNION orgs with ≥1
 * enrollment in it. The enabled set gives 0-enrollment "gap" rows (adoption
 * signal for platform admins); the enrollment set keeps this table reconciled
 * with the enrollee list and the #159 headline, which both count enrollments in
 * EVERY org regardless of current access (e.g. an org whose access was revoked
 * after a learner enrolled). Without the union such an org would appear in the
 * enrollee list but be missing here, and the per-org total would fall short.
 *
 * Counts are DISTINCT learners per org (COUNT DISTINCT user_id across the group's
 * editions). The per-course UNIQUE(org_id, user_id, course_id) does NOT make
 * "enrollment rows" and "distinct learners" equal once editions are grouped — a
 * learner could hold two sibling editions in one org (the enroll guard is app-level,
 * not a DB constraint), so we de-dup by learner here. Summed across orgs these can
 * still exceed the dialog's distinct-learner headline (#159) when one learner is
 * enrolled through several orgs.
 */
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
      GROUP BY o.id, o.name
      ORDER BY enrolled DESC, o.name`,
    [courseId],
  );
  return reply(200, { orgs });
});
