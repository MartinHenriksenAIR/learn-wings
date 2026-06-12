import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { orgId, courseId } = await req.json() as { orgId?: string; courseId?: string };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }
    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    const enrollees = await query(
      `SELECT e.user_id, p.full_name, e.status, e.enrolled_at, e.completed_at
         FROM enrollments e
         JOIN profiles p ON p.id = e.user_id
        WHERE e.org_id = $1 AND e.course_id = $2
        ORDER BY p.full_name`,
      [orgId, courseId],
    );
    return corsResponse(origin, 200, { enrollees });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-course-enrollees', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
