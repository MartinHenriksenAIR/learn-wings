import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { orgCourseAccessEnabled } from '../shared/course-visibility';

const ALLOWED_STATUSES = new Set(['enrolled', 'completed']);

export default endpoint('enrollment-create', async ({ req, profile, reply, requireOrgAdmin }) => {
  const body = await req.json() as { orgId?: unknown; userId?: unknown; courseId?: unknown; status?: unknown };
  const { orgId, userId, courseId, status } = body;

  // Validation first, authz second, db third (mirrors org-membership-create).
  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!userId || typeof userId !== 'string') {
    return reply(400, { error: 'userId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }
  if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
    return reply(400, { error: 'status must be one of: enrolled, completed' });
  }

  // Authorization: platform admin OR org admin of the target org.
  // RLS provenance: supabase/migrations/20260127153401_*.sql —
  // "Platform admins can do everything with enrollments" (is_platform_admin()).
  // The RLS schema only grants org admins SELECT on enrollments; this slice introduces
  // the admin-driven INSERT write path (used by EnrollUserDialog), authorized server-side
  // via isOrgAdmin to match the suite's admin-create convention.
  await requireOrgAdmin(orgId);

  // Course-precondition: course must exist and be published.
  const course = await queryOne<{ is_published: boolean }>(
    `SELECT is_published FROM courses WHERE id = $1`,
    [courseId],
  );
  if (!course) {
    return reply(404, { error: 'Course not found' });
  }
  if (!course.is_published) {
    return reply(400, { error: 'Course is not published' });
  }

  // Org-access precondition: only enforced for non-platform admins (platform admins override).
  // Publish state is checked separately above (distinct 404/400 errors), so this uses the
  // access-only shared fragment.
  if (!profile.is_platform_admin) {
    const access = await queryOne<{ ok: boolean }>(
      `SELECT ${orgCourseAccessEnabled({ courseRef: '$2', orgParam: 1 })} AS ok`,
      [orgId, courseId],
    );
    if (!access?.ok) {
      return reply(403, { error: 'Organization does not have access to this course' });
    }
  }

  const effectiveStatus = status ?? 'enrolled';

  try {
    const enrollment = await queryOne(
      `INSERT INTO enrollments (org_id, user_id, course_id, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at`,
      [orgId, userId, courseId, effectiveStatus],
    );
    return reply(200, { enrollment });
  } catch (dbErr: unknown) {
    if (isUniqueViolation(dbErr)) {
      return reply(409, { error: 'User is already enrolled in this course' });
    }
    if ((dbErr as { code?: string })?.code === '23503') {
      return reply(404, { error: 'User or course not found' });
    }
    throw dbErr;
  }
});
