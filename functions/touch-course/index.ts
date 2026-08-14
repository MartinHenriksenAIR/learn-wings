import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('touch-course', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, courseId } = await req.json() as { orgId?: unknown; courseId?: unknown };
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });
  if (!courseId || typeof courseId !== 'string') return reply(400, { error: 'courseId is required' });

  await requireActiveMember(orgId);

  await query(
    `UPDATE enrollments SET last_accessed_at = now() WHERE user_id = $1 AND org_id = $2 AND course_id = $3`,
    [profile.id, orgId, courseId],
  );
  return reply(200, { success: true });
});
