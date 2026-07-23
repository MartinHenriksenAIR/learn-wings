/**
 * Shared SQL fragments for course language-edition groups (#213).
 *
 * A "group" is the set of courses sharing a non-null course_group_id; a course
 * with NULL course_group_id is its own group of one. The group key is
 * COALESCE(course_group_id, id).
 *
 * Mirrors the fragment-builder contract of course-visibility.ts: these builders
 * interpolate SQL identifiers/ordinals supplied by the endpoint author — never
 * user input. Values still travel as bind parameters ($n).
 */

/** COALESCE(<alias>.course_group_id, <alias>.id) — the group key for GROUP BY / PARTITION BY. */
export function courseGroupKey(alias: string): string {
  return `COALESCE(${alias}.course_group_id, ${alias}.id)`;
}

/**
 * Subquery selecting every course id in the same group as the course bound at
 * $courseParam (includes that course itself; a standalone course yields just
 * itself). Intended for use inside `... IN ( <this> )`.
 */
export function courseGroupMemberIds(courseParam: number): string {
  return `SELECT gm.id FROM courses gm
           WHERE ${courseGroupKey('gm')} = (
             SELECT ${courseGroupKey('gc')} FROM courses gc WHERE gc.id = $${courseParam}
           )`;
}

/**
 * Boolean EXISTS predicate: the user at $userParam already has an enrolment in a
 * DIFFERENT edition of the same group as the course at $courseParam, within org
 * $orgParam. False for standalone courses (course_group_id IS NULL → no siblings).
 */
export function siblingEnrollmentExists({ orgParam, userParam, courseParam }: {
  orgParam: number;
  userParam: number;
  courseParam: number;
}): string {
  return `EXISTS (
    SELECT 1
      FROM enrollments e
      JOIN courses target ON target.id = $${courseParam}
      JOIN courses sib ON sib.id = e.course_id
     WHERE e.org_id = $${orgParam}
       AND e.user_id = $${userParam}
       AND target.course_group_id IS NOT NULL
       AND sib.course_group_id = target.course_group_id
       AND sib.id <> target.id
  )`;
}
