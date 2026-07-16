import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('course-review', async ({ req, profile, reply, requireActiveMember }) => {
  const body = await req.json() as {
    orgId?: unknown;
    courseId?: unknown;
    rating?: unknown;
    comment?: unknown;
  };

  const { orgId, courseId, rating, comment } = body;

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }
  if (!courseId || typeof courseId !== 'string') {
    return reply(400, { error: 'courseId is required' });
  }
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
    return reply(400, { error: 'rating must be an integer between 1 and 5' });
  }
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    return reply(400, { error: 'comment must be a string' });
  }
  const normalizedComment = typeof comment === 'string' && comment.trim() !== '' ? comment.trim() : null;
  if (normalizedComment !== null && normalizedComment.length > 1000) {
    return reply(400, { error: 'comment must be at most 1000 characters' });
  }

  // Authorization — membership (platform admins bypass)
  await requireActiveMember(orgId);

  // Upsert review — identity always from token
  const review = await queryOne(
    `INSERT INTO course_reviews (org_id, user_id, course_id, rating, comment)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (org_id, user_id, course_id)
DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
RETURNING id, org_id, user_id, course_id, rating, comment, created_at, updated_at`,
    [orgId, profile.id, courseId, rating, normalizedComment],
  );

  return reply(200, { review });
});
