import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// Admin list of an org's course assignments (individual + whole-org), joined with
// the course title, the target member's name (NULL = whole org), and the assigner.
// Gate: platform admin OR active org_admin of the org.
export default endpoint('assignments', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown };
  const { orgId } = body;
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });

  await requireOrgAdmin(orgId);

  const rows = await query(
    `SELECT ca.id, ca.org_id, ca.course_id, c.title AS course_title,
            ca.user_id, tp.full_name AS user_full_name,
            ca.mandatory, ca.due_date,
            ca.assigned_by_user_id, ap.full_name AS assigned_by_name,
            ca.created_at
       FROM course_assignments ca
       JOIN courses c        ON c.id = ca.course_id
       LEFT JOIN profiles tp ON tp.id = ca.user_id
       LEFT JOIN profiles ap ON ap.id = ca.assigned_by_user_id
      WHERE ca.org_id = $1
      ORDER BY ca.created_at DESC`,
    [orgId],
  );

  return reply(200, { assignments: rows });
});
