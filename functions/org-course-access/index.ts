import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-course-access', async ({ req, reply, requireOrgAdmin }) => {
  const { orgId } = await req.json() as { orgId?: string };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireOrgAdmin(orgId);

  // NO filter on oca.access — org admins manage toggle state for both 'enabled' and 'disabled' rows
  const access = await query(
    `SELECT oca.id, oca.org_id, oca.course_id, oca.access, oca.created_at,
            json_build_object(
              'id', c.id, 'title', c.title, 'description', c.description, 'level', c.level,
              'is_published', c.is_published, 'thumbnail_url', c.thumbnail_url,
              'created_by_user_id', c.created_by_user_id, 'created_at', c.created_at
            ) AS course
       FROM org_course_access oca
       JOIN courses c ON c.id = oca.course_id
      WHERE oca.org_id = $1
      ORDER BY c.title`,
    [orgId],
  );
  return reply(200, { access });
});
