import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }

    // Authorization: platform admin OR active member of the org
    const canAccess = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!canAccess) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const champions = await query(
      `SELECT a.*, json_build_object('id', pr.id, 'full_name', pr.full_name, 'department', pr.department) AS profile
       FROM ai_champions a JOIN profiles pr ON pr.id = a.user_id
       WHERE a.org_id = $1 ORDER BY a.assigned_at DESC`,
      [orgId],
    );

    return corsResponse(origin, 200, { champions }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('ai-champions', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
