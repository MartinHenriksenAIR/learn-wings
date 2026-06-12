import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    const body = await req.json() as {
      orgId?: unknown;
      courseId?: unknown;
      access?: unknown;
    };

    const { orgId, courseId, access } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    if (!courseId || typeof courseId !== 'string') {
      return corsResponse(origin, 400, { error: 'courseId is required' });
    }

    if (access !== 'enabled' && access !== 'disabled') {
      return corsResponse(origin, 400, { error: "access must be 'enabled' or 'disabled'" });
    }

    const record = await queryOne(
      `INSERT INTO org_course_access (org_id, course_id, access)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, course_id) DO UPDATE SET access = EXCLUDED.access
       RETURNING *`,
      [orgId, courseId, access],
    );

    return corsResponse(origin, 200, { record });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('course-access-set', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
