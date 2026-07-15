import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('enrollment-complete', async ({ req, profile, reply }) => {
    const { orgId, courseId } = await req.json() as { orgId: string; courseId: string };
    const updated = await query(
      `UPDATE enrollments SET status = 'completed', completed_at = NOW()
       WHERE user_id = $1 AND org_id = $2 AND course_id = $3
       RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at`,
      [profile.id, orgId, courseId]
    );
    // A zero-row UPDATE used to return success anyway — the silent no-op behind
    // dashboards stuck at "Completed 0" (#18). Surface it so the caller knows
    // nothing was recorded; enrollments.status/completed_at is what the dashboard
    // and course cards read.
    if (updated.length === 0) {
      return reply(404, { error: 'Enrollment not found' });
    }
    return reply(200, { success: true, enrollment: updated[0] });
});
