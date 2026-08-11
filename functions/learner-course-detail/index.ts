import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { resolveVisibilityContext } from '../shared/course-visibility';

/**
 * Read-only "read about a course" data for the learner course detail page (#403).
 *
 * Deliberately mirrors course-player-data's access rule (individual tier #354 vs
 * standard org) but is READ-ONLY: it creates NO enrollment. The player endpoint
 * auto-enrolls on open (implicit enrollment #357); merely *reading about* a course
 * must never start it, so this endpoint omits that INSERT entirely.
 *
 * Returns the course, its module outline (title + lesson_count + lesson NAMES per
 * module, but no lesson bodies — this is a summary, not the player), and the caller's
 * own enrollment status for this course (drives the state-aware Start / Fortsæt /
 * Gennemse CTA). Every read is scoped to profile.id — never a client-supplied user id.
 */
export default endpoint('learner-course-detail', async ({ req, profile, reply, requireActiveMember }) => {
  const { courseId, orgId } = await req.json() as { courseId?: unknown; orgId?: unknown };

  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }
  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  const course = await queryOne(
    'SELECT id, title, description, level, language, thumbnail_url, category_id FROM courses WHERE id = $1',
    [courseId],
  );
  if (!course) return reply(404, { error: 'Course not found' });

  // Individual tier (#354) uses a different visibility rule; the resolver also yields the
  // caller's server-authoritative language. Resolved for all callers (parity with course-player-data).
  const { isIndividual, language } = await resolveVisibilityContext(orgId, profile.id);

  // Platform admins bypass (suite convention); everyone else needs access to this course
  // through THIS org. Identical gate to course-player-data — but with NO implicit enroll.
  if (!profile.is_platform_admin) {
    if (isIndividual) {
      // Individual tier: active member of the placeholder + published + in the caller's
      // saved language (OR already enrolled, so a later language switch never locks them
      // out). org_course_access DELIBERATELY bypassed (the tier has no such rows).
      await requireActiveMember(orgId);
      const access = await queryOne<{ ok: boolean }>(
        `SELECT (
           $3::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM courses c
              WHERE c.id = $2 AND c.is_published = TRUE
                AND (c.language = $3
                     OR EXISTS (SELECT 1 FROM enrollments e
                                 WHERE e.course_id = c.id AND e.user_id = $1 AND e.org_id = $4))))
         AS ok`,
        [profile.id, courseId, language, orgId],
      );
      if (!access?.ok) return reply(403, { error: 'Course access denied' });
    } else {
      const access = await queryOne<{ ok: boolean }>(
        `SELECT EXISTS(
          SELECT 1
            FROM courses c
            JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
            JOIN org_memberships om ON om.org_id = oca.org_id
           WHERE c.id = $2 AND c.is_published = TRUE AND om.user_id = $1 AND om.status = 'active'
        ) AS ok`,
        [profile.id, courseId],
      );
      if (!access?.ok) return reply(403, { error: 'Course access denied' });
    }
  }

  // Module outline: title + lesson count. LEFT JOIN so a module with no lessons
  // still appears with count 0. `, cm.id` tie-breaker (issue #46) keeps order stable
  // across legacy rows carrying equal sort_order ranks.
  const moduleRows = await query<{ id: string; title: string; sort_order: number; lesson_count: number }>(
    `SELECT cm.id, cm.title, cm.sort_order, COUNT(l.id)::int AS lesson_count
       FROM course_modules cm
       LEFT JOIN lessons l ON l.module_id = cm.id
      WHERE cm.course_id = $1
      GROUP BY cm.id, cm.title, cm.sort_order
      ORDER BY cm.sort_order, cm.id`,
    [courseId],
  );

  // Lesson NAMES for the expandable Contents accordion (#409): each lesson is exactly
  // { id, title, sort_order } — NEVER bodies (no content_text / video / document paths);
  // this is a summary, not the player. Fetch all of this course's lessons in ONE query
  // (WHERE module_id = ANY) to avoid an N+1, then attach each to its module in JS.
  const moduleIds = moduleRows.map((m) => m.id);
  const lessonRows = moduleIds.length
    ? await query<{ id: string; module_id: string; title: string; sort_order: number }>(
        `SELECT id, module_id, title, sort_order
           FROM lessons
          WHERE module_id = ANY($1)
          ORDER BY sort_order, id`,
        [moduleIds],
      )
    : [];

  const lessonsByModule = new Map<string, { id: string; title: string; sort_order: number }[]>();
  for (const { id, module_id, title, sort_order } of lessonRows) {
    const list = lessonsByModule.get(module_id) ?? [];
    list.push({ id, title, sort_order });
    lessonsByModule.set(module_id, list);
  }

  // A module with zero lessons keeps lesson_count 0 and gets lessons: [].
  const modules = moduleRows.map((m) => ({ ...m, lessons: lessonsByModule.get(m.id) ?? [] }));

  // Caller's own enrollment status for this course in this org — drives the CTA label
  // (Start / Fortsæt / Gennemse). Scoped to profile.id; null when the course is not started.
  const enrollment = await queryOne<{ status: string }>(
    'SELECT status FROM enrollments WHERE user_id = $1 AND org_id = $2 AND course_id = $3',
    [profile.id, orgId, courseId],
  );

  return reply(200, { course, modules, enrollment: enrollment ?? null });
});
