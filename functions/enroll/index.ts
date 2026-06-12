import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { orgId, courseId } = await req.json() as { orgId?: unknown; courseId?: unknown };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    // Authorization step 1 — membership (platform admins bypass)
    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Authorization step 2 — course availability (applies to everyone, including platform admins)
    const availability = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS(
        SELECT 1
          FROM courses c
          JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
         WHERE c.id = $2 AND oca.org_id = $1 AND c.is_published = TRUE
      ) AS ok`,
      [orgId, courseId],
    );
    if (!availability?.ok) {
      return corsResponse(origin, 403, { error: 'Course not available for this organization' });
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
      return corsResponse(origin, 409, { error: 'Already enrolled' });
    }

    return corsResponse(origin, 200, { enrollment });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('enroll', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
