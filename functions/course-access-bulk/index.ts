import { query } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('course-access-bulk', async ({ req, reply }) => {
  const body = await req.json() as {
    orgId?: unknown;
  };

  const { orgId } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  const records = await query(
    `INSERT INTO org_course_access (org_id, course_id, access)
     SELECT $1, c.id, 'enabled' FROM courses c WHERE c.is_published = true
     ON CONFLICT (org_id, course_id) DO UPDATE SET access = 'enabled'
     RETURNING *`,
    [orgId],
  );

  return reply(200, { records });
});
