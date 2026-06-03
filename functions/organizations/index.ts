import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const { orgId } = await req.json() as { orgId?: string };

    if (orgId) {
      // Single org lookup
      const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
      if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

      const organization = await queryOne(
        `SELECT id, name, slug, logo_url, seat_limit, created_at FROM organizations WHERE id = $1`,
        [orgId],
      );
      if (!organization) return corsResponse(origin, 404, { error: 'Organization not found' }) as HttpResponseInit;

      return corsResponse(origin, 200, { organization }) as HttpResponseInit;
    }

    // List orgs
    if (profile.is_platform_admin) {
      const organizations = await query(
        `SELECT id, name, slug, logo_url, seat_limit, created_at FROM organizations ORDER BY name`,
      );
      return corsResponse(origin, 200, { organizations }) as HttpResponseInit;
    }

    const organizations = await query(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.created_at FROM organizations o JOIN org_memberships om ON om.org_id = o.id WHERE om.user_id = $1 AND om.status = 'active' ORDER BY o.name`,
      [profile.id],
    );
    return corsResponse(origin, 200, { organizations }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('organizations', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
