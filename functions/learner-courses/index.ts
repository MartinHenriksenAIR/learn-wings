import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate } from '../shared/course-visibility';

export default endpoint('learner-courses', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, language } = await req.json() as { orgId?: unknown; language?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const lang = language === 'en' || language === 'da' ? language : 'da';

  // Query 1: Available published courses for the org (shared visibility predicate;
  // equivalent to the old JOIN form — UNIQUE(org_id, course_id) on org_course_access
  // guarantees one access row per course per org), filtered to the viewer's UI language.
  // The language filter is relaxed (never the org-visibility/publish predicate) for
  // courses the learner is already enrolled in, so a language switch never hides them.
  const courses = await query(
    `SELECT c.id, c.title, c.description, c.level, c.language, c.is_published, c.thumbnail_url, c.created_by_user_id, c.created_at
       FROM courses c
      WHERE ${courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 })}
            AND (
                  c.language = $2
                  OR EXISTS (
                    SELECT 1 FROM enrollments e
                     WHERE e.course_id = c.id AND e.user_id = $3 AND e.org_id = $1
                  )
                )
      ORDER BY c.title`,
    [orgId, lang, profile.id],
  );

  // Query 2: Caller's own enrollments in this org, scoped to profile.id (never a client-supplied user id).
  const enrollments = await query(
    `SELECT id, org_id, user_id, course_id, status, enrolled_at, completed_at
       FROM enrollments
      WHERE user_id = $1 AND org_id = $2
      ORDER BY enrolled_at DESC`,
    [profile.id, orgId],
  );

  return reply(200, { courses, enrollments });
});
