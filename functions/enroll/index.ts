import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { courseVisibilityPredicate } from '../shared/course-visibility';
import { siblingEnrollmentExists } from '../shared/course-groups';

export default endpoint('enroll', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId, courseId } = await req.json() as { orgId?: unknown; courseId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }

  // Authorization step 1 — membership (platform admins bypass)
  await requireActiveMember(orgId);

  // Authorization step 2 — course availability (applies to everyone, including platform admins)
  const availability = await queryOne<{ ok: boolean }>(
    `SELECT EXISTS(
      SELECT 1
        FROM courses c
       WHERE c.id = $2 AND ${courseVisibilityPredicate({ courseAlias: 'c', orgParam: 1 })}
    ) AS ok`,
    [orgId, courseId],
  );
  if (!availability?.ok) {
    return reply(403, { error: 'Course not available for this organization' });
  }

  // #213: a learner may hold only one language edition of a course per org.
  const sibling = await queryOne<{ blocked: boolean }>(
    `SELECT ${siblingEnrollmentExists({ orgParam: 1, userParam: 3, courseParam: 2 })} AS blocked`,
    [orgId, courseId, profile.id],
  );
  if (sibling?.blocked) {
    return reply(409, { error: 'Already enrolled in this course in another language' });
  }

  // Insert enrollment — duplicate-safe via the unique constraint: ON CONFLICT
  // DO NOTHING returns no row, which we surface as 409 (re-enroll is rejected, not silently idempotent)
  const enrollment = await queryOne(
    `INSERT INTO enrollments (org_id, user_id, course_id, status)
VALUES ($1, $2, $3, 'enrolled')
ON CONFLICT (org_id, user_id, course_id) DO NOTHING
RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at`,
    [orgId, profile.id, courseId],
  );

  if (!enrollment) {
    return reply(409, { error: 'Already enrolled' });
  }

  return reply(200, { enrollment });
});
