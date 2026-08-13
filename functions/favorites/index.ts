import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate, individualCourseVisibility, resolveVisibilityContext } from '../shared/course-visibility';

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

  // #354 — the individual tier has no org_course_access rows; its catalogue is every
  // published course in the caller's server-authoritative language. Standard orgs keep
  // the shared published + org-enabled predicate. Detection is by kind, never a fixed id.
  const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);
  // $1 is always profile.id (never a client-supplied user id). Standard binds orgId at $2
  // (the predicate's orgParam); individual binds the resolved language at $2 (langParam).
  const visibility = isIndividual
    ? individualCourseVisibility({ courseAlias: 'c', langParam: 2 })
    : courseVisibilityPredicate({ courseAlias: 'c', orgParam: 2 });
  // $3 is always the org the list is scoped to, bound for the enrollment join below. It is a
  // separate slot from the visibility param ($2) because the individual tier binds language at $2.
  const params = isIndividual ? [profile.id, language, orgId] : [profile.id, orgId, orgId];

  // Base column list mirrors learner-courses (the catalog's Course[] shape); `completed` is
  // derived from the caller's own enrollment in THIS org — the same signal learner-assignments
  // surfaces — so the favorites list shows the same Completed state as the mandatory list (#456).
  // enrollments is UNIQUE(org_id,user_id,course_id), so the LEFT JOIN yields at most one row
  // (no fan-out, no GROUP BY); enrollment_status is only 'enrolled'|'completed'.
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

  // completed comes back NULL when there is no enrollment row — normalize to a strict boolean.
  const courses = (Array.isArray(rows) ? rows : []).map((r) => {
    const row = r as Record<string, unknown>;
    return { ...row, completed: row.completed === true };
  });

  return reply(200, { courses });
});
