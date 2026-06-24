import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';
import { orgCourseAccessEnabled } from '../shared/course-visibility';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const { orgId } = await req.json() as { orgId?: string };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // ONE rollup query — DELIBERATELY no is_published filter (parity: pre-migration UI showed all
    // enabled-access courses regardless of publish state), hence the access-only shared fragment.
    // Equivalent to the old FROM org_course_access JOIN courses form — UNIQUE(org_id, course_id)
    // on org_course_access guarantees one access row per course per org.
    const courses = await query(
      `SELECT c.id, c.title, c.level,
              COUNT(e.id)::int AS enrolled,
              COUNT(e.id) FILTER (WHERE e.status = 'completed')::int AS completed
         FROM courses c
         LEFT JOIN enrollments e ON e.course_id = c.id AND e.org_id = $1
        WHERE ${orgCourseAccessEnabled({ courseRef: 'c.id', orgParam: 1 })}
        GROUP BY c.id, c.title, c.level
        ORDER BY c.title`,
      [orgId],
    );
    return corsResponse(origin, 200, { courses });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-course-progress', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
