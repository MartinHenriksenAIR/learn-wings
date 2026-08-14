import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate, individualCourseVisibility, resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('favorites', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);
  const visibility = isIndividual
    ? individualCourseVisibility({ courseAlias: 'c', langParam: 2 })
    : courseVisibilityPredicate({ courseAlias: 'c', orgParam: 2 });
  const params = isIndividual ? [profile.id, language, orgId] : [profile.id, orgId, orgId];

  const rows = await query(
    `SELECT c.id, c.title, c.description, c.level, c.language, c.is_published, c.thumbnail_url, c.created_by_user_id, c.created_at,
            COALESCE(e.status = 'completed', false) AS completed
       FROM course_favorites f
       JOIN courses c ON c.id = f.course_id
       LEFT JOIN enrollments e
         ON e.user_id = $1 AND e.course_id = c.id AND e.org_id = $3
      WHERE f.user_id = $1
            AND ${visibility}
      ORDER BY f.created_at DESC`,
    params,
  );

  const courses = (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as Record<string, unknown>;
    return { ...row, completed: row.completed === true };
  });

  return reply(200, { courses });
});
