import { queryOne } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('course-access-set', async ({ req, reply }) => {
    const body = await req.json() as {
      orgId?: unknown;
      courseId?: unknown;
      access?: unknown;
    };

    const { orgId, courseId, access } = body;

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    if (!courseId || typeof courseId !== 'string') {
      return reply(400, { error: 'courseId is required' });
    }

    if (access !== 'enabled' && access !== 'disabled') {
      return reply(400, { error: "access must be 'enabled' or 'disabled'" });
    }

    const record = await queryOne(
      `INSERT INTO org_course_access (org_id, course_id, access)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, course_id) DO UPDATE SET access = EXCLUDED.access
       RETURNING *`,
      [orgId, courseId, access],
    );

    return reply(200, { record });
});
