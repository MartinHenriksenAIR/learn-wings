import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const { orgId, features } = await req.json() as { orgId?: unknown; features?: unknown };

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }

    if (features === null || typeof features !== 'object' || Array.isArray(features)) {
      return corsResponse(origin, 400, { error: 'features must be a plain object' }) as HttpResponseInit;
    }

    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // updated_at is managed by a DB trigger on UPDATE; updated_by is the authenticated caller's profile id.
    // JSON.stringify is deliberate, not required: pg would auto-stringify a plain object, but explicit
    // serialization sidesteps pg's array-vs-jsonb param footgun if the features guard ever loosens.
    const settings = await queryOne(
      `INSERT INTO org_settings (org_id, features, updated_by)
VALUES ($1, $2, $3)
ON CONFLICT (org_id) DO UPDATE SET features = EXCLUDED.features, updated_by = EXCLUDED.updated_by
RETURNING org_id, features`,
      [orgId, JSON.stringify(features), profile.id],
    );

    return corsResponse(origin, 200, { settings }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('org-settings-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
