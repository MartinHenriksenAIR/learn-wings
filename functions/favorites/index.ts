import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate } from '../shared/course-visibility';

// #358 — the caller's favorited courses for one org. Favorites are org-neutral
// in storage (course_favorites has no org_id), so the org scope is applied at
// read time: the SAME courseVisibilityPredicate learner-courses uses filters the
// list down to exactly the org-visible catalog, so Favorites is always a subset
// of what the learner sees in the catalog. A course the org later disables (or
// that gets unpublished) drops out of the list without deleting the favorite row.
export default endpoint('favorites', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  // profile.id is $1 (never a client-supplied user id), orgId is $2 (the predicate's orgParam).
  // Column list mirrors learner-courses so the row shape is identical to the catalog's Course[].
  const courses = await query(
    `SELECT c.id, c.title, c.description, c.level, c.language, c.is_published, c.thumbnail_url, c.created_by_user_id, c.created_at
       FROM course_favorites f
       JOIN courses c ON c.id = f.course_id
      WHERE f.user_id = $1
            AND ${courseVisibilityPredicate({ courseAlias: 'c', orgParam: 2 })}
      ORDER BY f.created_at DESC`,
    [profile.id, orgId],
  );

  return reply(200, { courses });
});
