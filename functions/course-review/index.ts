import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as {
      orgId?: unknown;
      courseId?: unknown;
      rating?: unknown;
      comment?: unknown;
    };

    const { orgId, courseId, rating, comment } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }
    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' }) as HttpResponseInit;
    }
    if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
      return corsResponse(origin, 400, { error: 'rating must be an integer between 1 and 5' }) as HttpResponseInit;
    }
    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      return corsResponse(origin, 400, { error: 'comment must be a string' }) as HttpResponseInit;
    }
    const normalizedComment = typeof comment === 'string' && comment.trim() !== '' ? comment.trim() : null;
    if (normalizedComment !== null && normalizedComment.length > 1000) {
      return corsResponse(origin, 400, { error: 'comment must be at most 1000 characters' }) as HttpResponseInit;
    }

    // Authorization — membership (platform admins bypass)
    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // Upsert review — identity always from token
    const review = await queryOne(
      `INSERT INTO course_reviews (org_id, user_id, course_id, rating, comment)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (org_id, user_id, course_id)
DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
RETURNING id, org_id, user_id, course_id, rating, comment, created_at, updated_at`,
      [orgId, profile.id, courseId, rating, normalizedComment],
    );

    return corsResponse(origin, 200, { review }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('course-review', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
