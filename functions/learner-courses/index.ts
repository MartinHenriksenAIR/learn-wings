import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate, resolveVisibilityContext } from '../shared/course-visibility';

export default endpoint('learner-courses', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, language } = await req.json() as { orgId?: unknown; language?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const { isIndividual, language: savedLang } = await resolveVisibilityContext(orgId, profile.id);
  // Standard orgs keep the client-supplied UI language; individuals use the
  // server-authoritative saved language (the client cannot widen its catalogue).
  const lang = isIndividual ? savedLang : (language === 'en' || language === 'da' ? language : 'da');

  // Individuals bypass org_course_access entirely — visibility is PUBLISHED-ONLY here,
  // so the language filter lives solely in the shared OR-group below (otherwise a
  // language=$2 baked into the outer AND would absorb the OR-group via B AND (B OR D) ≡ B,
  // silently dropping the enrolled-relaxation). Standard orgs keep the published + 'enabled'
  // org_course_access predicate.
  const visibility = isIndividual
    ? 'c.is_published = TRUE'                                          // published; org access bypassed
    : courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 });    // published + org access

  // Query 1: Available published courses. In both branches the language filter is
  // relaxed (never the visibility/publish predicate) for courses the learner is
  // already enrolled in, so a language switch never hides them.
  const courses = await query(
    `SELECT c.id, c.title, c.description, c.level, c.language, c.is_published, c.thumbnail_url, c.category_id, c.created_by_user_id, c.created_at
       FROM courses c
      WHERE ${visibility}
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
    `SELECT id, org_id, user_id, course_id, status, enrolled_at, completed_at, last_accessed_at
       FROM enrollments
      WHERE user_id = $1 AND org_id = $2
      ORDER BY enrolled_at DESC`,
    [profile.id, orgId],
  );

  const courseIds = enrollments.map((e) => (e as { course_id: string }).course_id);

  // No enrollments → no progress to compute; skip the count queries entirely.
  if (courseIds.length === 0) {
    return reply(200, { courses, enrollments, progress: {} });
  }

  // Per-course lesson progress for the caller's enrolled courses. These two batched
  // COUNT queries mirror functions/learner-dashboard/index.ts verbatim (same aliases,
  // params, and zero-fill) so both surfaces derive progress identically — no N+1.
  const totalsRows = await query<{ course_id: string; total: number }>(
    `SELECT cm.course_id, COUNT(l.id)::int AS total
       FROM course_modules cm
       JOIN lessons l ON l.module_id = cm.id
      WHERE cm.course_id = ANY($1::uuid[])
      GROUP BY cm.course_id`,
    [courseIds],
  );

  const completedRows = await query<{ course_id: string; completed: number }>(
    `SELECT cm.course_id, COUNT(*)::int AS completed
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN course_modules cm ON cm.id = l.module_id
      WHERE lp.user_id = $1 AND lp.org_id = $2 AND lp.status = 'completed'
        AND cm.course_id = ANY($3::uuid[])
      GROUP BY cm.course_id`,
    [profile.id, orgId, courseIds],
  );

  const totalsMap = new Map<string, number>();
  for (const row of totalsRows) {
    totalsMap.set(row.course_id, row.total);
  }

  const completedMap = new Map<string, number>();
  for (const row of completedRows) {
    completedMap.set(row.course_id, row.completed);
  }

  const progress: Record<string, { total: number; completed: number }> = {};
  for (const courseId of courseIds) {
    progress[courseId] = {
      total: totalsMap.get(courseId) ?? 0,
      completed: completedMap.get(courseId) ?? 0,
    };
  }

  return reply(200, { courses, enrollments, progress });
});
