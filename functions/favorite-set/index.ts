import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled, individualCourseVisibility, resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('favorite-set', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as { orgId?: unknown; courseId?: unknown; favorite?: unknown };
  const { orgId, courseId, favorite } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }
  if (typeof favorite !== 'boolean') {
    return reply(400, { error: 'favorite must be a boolean' });
  }

  await requireActiveMember(orgId);

  if (favorite) {
    const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);
    const access = isIndividual
      ? await queryOne<{ ok: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM courses c
              WHERE c.id = $2 AND ${individualCourseVisibility({ courseAlias: 'c', langParam: 3 })}
           ) AS ok`,
          [orgId, courseId, language],
        )
      : await queryOne<{ ok: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM courses c
              WHERE c.id = $2 AND c.is_published = TRUE
                AND ${orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })}
           ) AS ok`,
          [orgId, courseId],
        );
    if (!access?.ok) {
      return reply(403, { error: 'Course access denied' });
    }

    await query(
      `INSERT INTO course_favorites (user_id, course_id) VALUES ($1, $2)
       ON CONFLICT (user_id, course_id) DO NOTHING`,
      [profile.id, courseId],
    );
  } else {
    await query(
      `DELETE FROM course_favorites WHERE user_id = $1 AND course_id = $2`,
      [profile.id, courseId],
    );
  }

  return reply(200, { favorited: favorite });
});
