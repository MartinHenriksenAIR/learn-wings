import { query, queryOne, isUniqueViolation } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

interface CourseRow {
  id: string;
  language: 'en' | 'da' | null;
  course_group_id: string | null;
}

export default adminEndpoint('course-translation-link', async ({ req, reply }) => {
  const { action, courseId, otherCourseId } = await req.json() as {
    action?: unknown;
    courseId?: unknown;
    otherCourseId?: unknown;
  };

  if (action !== 'link' && action !== 'unlink') {
    return reply(400, { error: "action must be 'link' or 'unlink'" });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  if (action === 'unlink') {
    const course = await queryOne<{ id: string; course_group_id: string | null }>(
      `SELECT id, course_group_id FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!course) return reply(404, { error: 'Course not found' });
    if (!course.course_group_id) return reply(200, { ok: true }); // already standalone

    const groupId = course.course_group_id;
    await query(`UPDATE courses SET course_group_id = NULL WHERE id = $1`, [courseId]);

    // A group of one is meaningless — collapse the lone remaining edition to standalone.
    const rest = await queryOne<{ remaining: number }>(
      `SELECT COUNT(*)::int AS remaining FROM courses WHERE course_group_id = $1`,
      [groupId],
    );
    if ((rest?.remaining ?? 0) === 1) {
      await query(`UPDATE courses SET course_group_id = NULL WHERE course_group_id = $1`, [groupId]);
    }
    return reply(200, { ok: true });
  }

  // action === 'link'
  if (!otherCourseId || typeof otherCourseId !== 'string') {
    return reply(400, { error: 'otherCourseId is required' });
  }
  if (otherCourseId === courseId) {
    return reply(400, { error: 'A course cannot be linked to itself' });
  }

  const course = await queryOne<CourseRow>(
    `SELECT id, language, course_group_id FROM courses WHERE id = $1`,
    [courseId],
  );
  const other = await queryOne<CourseRow>(
    `SELECT id, language, course_group_id FROM courses WHERE id = $1`,
    [otherCourseId],
  );
  if (!course || !other) return reply(404, { error: 'Course not found' });

  if (!course.language || !other.language) {
    return reply(400, { error: 'Both courses must have a language set before linking' });
  }
  // No group-merging: the candidate must be standalone.
  if (other.course_group_id) {
    return reply(409, { error: 'The other course is already linked; unlink it first' });
  }

  if (course.course_group_id) {
    // Join the existing group — reject if that language already exists in it.
    const conflict = await queryOne<{ conflict: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM courses WHERE course_group_id = $1 AND language = $2
       ) AS conflict`,
      [course.course_group_id, other.language],
    );
    if (conflict?.conflict) {
      return reply(409, { error: `A ${other.language} edition already exists in this group` });
    }
    try {
      await query(`UPDATE courses SET course_group_id = $1 WHERE id = $2`, [course.course_group_id, other.id]);
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return reply(409, { error: `A ${other.language} edition already exists in this group` });
      }
      throw dbErr;
    }
    return reply(200, { ok: true });
  }

  // Both standalone — the two languages must differ, then mint one shared group id.
  if (course.language === other.language) {
    return reply(409, { error: `A ${other.language} edition already exists in this group` });
  }
  try {
    await query(
      `WITH g AS (SELECT gen_random_uuid() AS gid)
       UPDATE courses SET course_group_id = g.gid FROM g WHERE courses.id IN ($1, $2)`,
      [course.id, other.id],
    );
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: `A ${other.language} edition already exists in this group` });
    }
    throw dbErr;
  }
  return reply(200, { ok: true });
});
