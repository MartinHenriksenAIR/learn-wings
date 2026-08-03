import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

// Lightweight, fire-and-forget "course opened" write. The learner catalog orders
// the enrolled group by enrollments.last_accessed_at (#339); opening the player is
// one of the two activity signals that stamp it (the other is lesson-progress).
export default endpoint('touch-course', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, courseId } = await req.json() as { orgId?: unknown; courseId?: unknown };
  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });
  if (!courseId || typeof courseId !== 'string') return reply(400, { error: 'courseId is required' });

  await requireActiveMember(orgId);

  // No-op (0 rows) if the caller isn't enrolled (e.g. a platform admin previewing).
  await query(
    `UPDATE enrollments SET last_accessed_at = now() WHERE user_id = $1 AND org_id = $2 AND course_id = $3`,
    [profile.id, orgId, courseId],
  );
  return reply(200, { success: true });
});
