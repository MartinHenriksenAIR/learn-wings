import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });
    const { orgId, courseId } = await req.json() as { orgId: string; courseId: string };
    const updated = await query(
      `UPDATE enrollments SET status = 'completed', completed_at = NOW()
       WHERE user_id = $1 AND org_id = $2 AND course_id = $3
       RETURNING id, org_id, user_id, course_id, status, enrolled_at, completed_at`,
      [profile.id, orgId, courseId]
    );
    // A zero-row UPDATE used to return success anyway — the silent no-op behind
    // dashboards stuck at "Completed 0" (#18). Surface it so the caller knows
    // nothing was recorded; enrollments.status/completed_at is what the dashboard
    // and course cards read.
    if (updated.length === 0) {
      return corsResponse(origin, 404, { error: 'Enrollment not found' });
    }
    return corsResponse(origin, 200, { success: true, enrollment: updated[0] });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('enrollment-complete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
