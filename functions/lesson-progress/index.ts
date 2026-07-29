import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('lesson-progress', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, lessonId, status } = await req.json() as { orgId: string; lessonId: string; status: string };

  // Authorization — membership (platform admins bypass)
  await requireActiveMember(orgId);

  await query(
    `INSERT INTO lesson_progress (org_id, user_id, lesson_id, status, completed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE SET status = $4, completed_at = NOW()`,
    [orgId, profile.id, lessonId, status]
  );

  // Recording lesson activity is one of the two signals that stamp the enrollment's
  // last_accessed_at, which drives the learner catalog's recency ordering (#339).
  // No-op (0 rows) if the caller isn't enrolled in the lesson's course (e.g. a
  // platform admin) — that's correct.
  //
  // Best-effort: the progress upsert above has already committed and is what the
  // learner (and #289's optimistic-rollback) depends on. This recency stamp is
  // non-essential telemetry, so a failure here is logged and swallowed rather than
  // 500-ing an otherwise successful progress save. It self-heals on the next activity.
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
