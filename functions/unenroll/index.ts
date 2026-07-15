import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('unenroll', async ({ req, profile, reply }) => {
  const { enrollmentId } = await req.json() as { enrollmentId?: unknown };

  if (!enrollmentId || typeof enrollmentId !== 'string') {
    return reply(400, { error: 'enrollmentId is required' });
  }

  // NOTE: Platform admins get NO special path here — unenroll is strictly self-service.
  // Admin-driven unenrollment will be a separate admin endpoint in a later slice.

  // Ownership enforced in WHERE: only the caller's own enrollment can match.
  // This doubles as authorization — no separate authz query needed.
  // Deliberately indistinguishable 404 for nonexistent vs. other users' enrollments
  // to prevent enrollment-id probing.
  const deleted = await queryOne<{ id: string }>(
    `-- Ownership enforced in WHERE: only the caller's own enrollment can match.
DELETE FROM enrollments
 WHERE id = $1 AND user_id = $2
RETURNING id`,
    [enrollmentId, profile.id],
  );

  if (!deleted) {
    // 404 covers both nonexistent ids and other users' enrollments —
    // deliberately indistinguishable to prevent enrollment-id probing.
    return reply(404, { error: 'Enrollment not found' });
  }

  return reply(200, { success: true });
});
