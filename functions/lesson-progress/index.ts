import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('lesson-progress', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, lessonId, status } = await req.json() as { orgId: string; lessonId: string; status: string };

  await requireActiveMember(orgId);

  await query(
    `INSERT INTO lesson_progress (org_id, user_id, lesson_id, status, completed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE SET status = $4, completed_at = NOW()`,
    [orgId, profile.id, lessonId, status]
  );

  try {
    await query(
      `UPDATE enrollments SET last_accessed_at = now()
        WHERE user_id = $1 AND org_id = $2
          AND course_id = (SELECT cm.course_id FROM lessons l JOIN course_modules cm ON cm.id = l.module_id WHERE l.id = $3)`,
      [profile.id, orgId, lessonId],
    );
  } catch (err) {
    console.error('lesson-progress: last_accessed_at stamp failed (non-fatal)', err);
  }
  return reply(200, { success: true });
});
