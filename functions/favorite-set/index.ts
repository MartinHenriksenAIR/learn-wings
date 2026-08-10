import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled, individualCourseVisibility, resolveVisibilityContext } from '../shared/course-visibility';

// #358 — toggle a course favorite for the caller. The table is org-neutral
// (PK user_id, course_id), so writes are keyed on profile.id (never a client id).
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
    // Gate the ADD on the same access rule as the catalog, or a client could favorite a
    // course it can't see. #354 — the individual tier has no org_course_access rows: its
    // rule is published + the caller's server-authoritative language. Standard orgs keep the
    // published + org-enabled gate. Detection is by kind (via the resolver), never a fixed id.
    const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);
    // courseId is $2 in both branches. Standard: orgId is $1 (the fragment's orgParam).
    // Individual: language is $3 (the fragment's langParam); orgId stays $1 (unused there).
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

    // Idempotent add — the PK (user_id, course_id) is the conflict target.
    await query(
      `INSERT INTO course_favorites (user_id, course_id) VALUES ($1, $2)
       ON CONFLICT (user_id, course_id) DO NOTHING`,
      [profile.id, courseId],
    );
  } else {
    // Remove — deliberately NO access gate: a learner must always be able to drop
    // a favorite, even for a course the org later disabled.
    await query(
      `DELETE FROM course_favorites WHERE user_id = $1 AND course_id = $2`,
      [profile.id, courseId],
    );
  }

  return reply(200, { favorited: favorite });
});
