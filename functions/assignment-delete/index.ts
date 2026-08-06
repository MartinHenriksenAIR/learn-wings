import { queryOne, query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// Remove an assignment. Authorized by loading the row's org first, then
// requireOrgAdmin(that org) — so an org admin can never delete another org's
// assignment. Removing a whole-org row removes it for everyone (by design).
export default endpoint('assignment-delete', async ({ req, reply, requireOrgAdmin }) => {
  const body = await req.json() as { assignmentId?: unknown };
  const { assignmentId } = body;
  if (!assignmentId || typeof assignmentId !== 'string') {
    return reply(400, { error: 'assignmentId is required' });
  }

  const row = await queryOne<{ org_id: string }>(
    `SELECT org_id FROM course_assignments WHERE id = $1`, [assignmentId],
  );
  if (!row) return reply(404, { error: 'Assignment not found' });

  await requireOrgAdmin(row.org_id);

  await query(`DELETE FROM course_assignments WHERE id = $1`, [assignmentId]);
  return reply(200, { deleted: true });
});
