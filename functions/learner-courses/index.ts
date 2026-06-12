import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { orgId } = await req.json() as { orgId?: unknown };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // Query 1: Available published courses for the org.
    // No DISTINCT needed — UNIQUE(org_id, course_id) on org_course_access guarantees one access row per course per org.
    const courses = await query(
      `SELECT c.id, c.title, c.description, c.level, c.is_published, c.thumbnail_url, c.created_by_user_id, c.created_at
         FROM courses c
         JOIN org_course_access oca ON oca.course_id = c.id AND oca.access = 'enabled'
        WHERE oca.org_id = $1 AND c.is_published = TRUE
        ORDER BY c.title`,
      [orgId],
    );

    // Query 2: Caller's own enrollments in this org, scoped to profile.id (never a client-supplied user id).
    const enrollments = await query(
      `SELECT id, org_id, user_id, course_id, status, enrolled_at, completed_at
         FROM enrollments
        WHERE user_id = $1 AND org_id = $2
        ORDER BY enrolled_at DESC`,
      [profile.id, orgId],
    );

    return corsResponse(origin, 200, { courses, enrollments });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('learner-courses', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
