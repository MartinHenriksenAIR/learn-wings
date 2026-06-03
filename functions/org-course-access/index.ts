import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const { orgId } = await req.json() as { orgId?: string };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }

    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // NO filter on oca.access — org admins manage toggle state for both 'enabled' and 'disabled' rows
    const access = await query(
      `SELECT oca.id, oca.org_id, oca.course_id, oca.access, oca.created_at,
              json_build_object(
                'id', c.id, 'title', c.title, 'description', c.description, 'level', c.level,
                'is_published', c.is_published, 'thumbnail_url', c.thumbnail_url,
                'created_by_user_id', c.created_by_user_id, 'created_at', c.created_at
              ) AS course
         FROM org_course_access oca
         JOIN courses c ON c.id = oca.course_id
        WHERE oca.org_id = $1
        ORDER BY c.title`,
      [orgId],
    );
    return corsResponse(origin, 200, { access }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('org-course-access', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
