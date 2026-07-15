import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('lesson-progress', async ({ req, profile, reply }) => {
    const { orgId, lessonId, status } = await req.json() as { orgId: string; lessonId: string; status: string };
    await query(
      `INSERT INTO lesson_progress (org_id, user_id, lesson_id, status, completed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (org_id, user_id, lesson_id) DO UPDATE SET status = $4, completed_at = NOW()`,
      [orgId, profile.id, lessonId, status]
    );
    return reply(200, { success: true });
});
