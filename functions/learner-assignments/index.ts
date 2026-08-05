import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// The learner's own assigned/mandatory courses for one org — the read the
// Min Træning view (#364) consumes. Self-scoped (never trusts a client user id).
// Resolves individual (user_id = caller) + whole-org (user_id IS NULL)
// assignments, deduped by course: mandatory wins, earliest real due date wins.
// completed/overdue are derived from the caller's enrollment in this org.
export default endpoint('learner-assignments', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as { orgId?: unknown };
  const { orgId } = body;
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });

  await requireActiveMember(orgId);

  const rows = await query(
    `SELECT ca.course_id,
            c.title AS course_title,
            c.thumbnail_url,
            bool_or(ca.mandatory)                                   AS mandatory,
            min(ca.due_date)                                        AS due_date,
            bool_or(e.status = 'completed')                         AS completed,
            (min(ca.due_date) < CURRENT_DATE
             AND NOT bool_or(e.status = 'completed'))               AS overdue
       FROM course_assignments ca
       JOIN courses c ON c.id = ca.course_id
       LEFT JOIN enrollments e
         ON e.org_id = ca.org_id AND e.user_id = $2 AND e.course_id = ca.course_id
      WHERE ca.org_id = $1
        AND (ca.user_id = $2 OR ca.user_id IS NULL)
        AND c.is_published = true
      GROUP BY ca.course_id, c.title, c.thumbnail_url
      ORDER BY (min(ca.due_date) IS NULL), min(ca.due_date) ASC, c.title ASC`,
    [orgId, profile.id],
  );

  // overdue/completed can come back NULL when there is no due date / no enrollment
  // row — normalize to strict booleans for the client contract.
  const assignments = (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as Record<string, unknown>;
    return { ...row, completed: row.completed === true, overdue: row.overdue === true };
  });

  return reply(200, { assignments });
});
