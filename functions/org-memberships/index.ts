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

    const { orgId } = await req.json() as { orgId?: string };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    // NO status filter — org admins manage their full roster incl. invited/disabled members
    const memberships = await query(
      `SELECT om.id, om.org_id, om.user_id, om.role, om.status, om.created_at,
              p.full_name, p.email, p.avatar_url, p.department
         FROM org_memberships om
         JOIN profiles p ON p.id = om.user_id
        WHERE om.org_id = $1
        ORDER BY p.full_name`,
      [orgId],
    );
    return corsResponse(origin, 200, { memberships });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-memberships', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
