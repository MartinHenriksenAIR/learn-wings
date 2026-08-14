import { queryOne, query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

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
