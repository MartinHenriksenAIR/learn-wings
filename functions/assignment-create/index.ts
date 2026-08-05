import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled } from '../shared/course-visibility';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Assign a course to a learner (userId set) or a whole org (userId omitted/null,
// applied dynamically to current + future active members). mandatory=false means
// "recommended". due_date is optional and informational.
export default endpoint('assignment-create', async ({ req, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as {
    orgId?: unknown; courseId?: unknown; userId?: unknown; mandatory?: unknown; dueDate?: unknown;
  };
  const { orgId, courseId, userId, mandatory, dueDate } = body;

  if (!orgId || typeof orgId !== 'string') return reply(400, { error: 'orgId is required' });
  if (!courseId || typeof courseId !== 'string') return reply(400, { error: 'courseId is required' });
  if (userId !== undefined && userId !== null && typeof userId !== 'string') {
    return reply(400, { error: 'userId must be a string' });
  }
  if (mandatory !== undefined && typeof mandatory !== 'boolean') {
    return reply(400, { error: 'mandatory must be a boolean' });
  }
  if (dueDate !== undefined && dueDate !== null && (typeof dueDate !== 'string' || !DATE_RE.test(dueDate))) {
    return reply(400, { error: 'dueDate must be an ISO date (YYYY-MM-DD)' });
  }

  // Authorization: platform admin OR active org_admin of the target org.
  await requireOrgAdmin(orgId);

  const course = await queryOne<{ is_published: boolean }>(
    `SELECT is_published FROM courses WHERE id = $1`, [courseId],
  );
  if (!course) return reply(404, { error: 'Course not found' });
  if (!course.is_published) return reply(400, { error: 'Course is not published' });

  // Org-access precondition (platform admins override, matching enrollment-create).
  if (!profile.is_platform_admin) {
    const access = await queryOne<{ ok: boolean }>(
      `SELECT ${orgCourseAccessEnabled({ courseRef: '$2', orgParam: 1 })} AS ok`, [orgId, courseId],
    );
    if (!access?.ok) return reply(403, { error: 'Organization does not have access to this course' });
  }

  const targetUserId = (userId as string | undefined | null) ?? null;
  if (targetUserId !== null) {
    // Org-isolation guard: an individual target must be an active member of THIS org.
    const member = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM org_memberships WHERE user_id = $1 AND org_id = $2 AND status = 'active') AS ok`,
      [targetUserId, orgId],
    );
    if (!member?.ok) return reply(400, { error: 'User is not an active member of this organization' });
  }

  const effectiveMandatory = mandatory === undefined ? true : mandatory as boolean;
  const effectiveDue = (dueDate as string | undefined | null) ?? null;

  try {
    const assignment = await queryOne(
      `INSERT INTO course_assignments (org_id, user_id, course_id, mandatory, due_date, assigned_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, org_id, user_id, course_id, mandatory, due_date, assigned_by_user_id, created_at`,
      [orgId, targetUserId, courseId, effectiveMandatory, effectiveDue, profile.id],
    );
    return reply(200, { assignment });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) return reply(409, { error: 'This course is already assigned' });
    if ((dbErr as { code?: string })?.code === '23503') return reply(404, { error: 'User or course not found' });
    throw dbErr;
  }
});
