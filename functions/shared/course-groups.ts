export function courseGroupKey(alias: string): string {
  return `COALESCE(${alias}.course_group_id, ${alias}.id)`;
}

export function courseGroupMemberIds(courseParam: number): string {
  return `SELECT gm.id FROM courses gm
           WHERE ${courseGroupKey('gm')} = (
             SELECT ${courseGroupKey('gc')} FROM courses gc WHERE gc.id = $${courseParam}
           )`;
}

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
