import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface ResourceRow {
  id: string;
  org_id: string;
  user_id: string;
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { resourceId?: unknown };
    const { resourceId } = body;

    if (!resourceId || typeof resourceId !== 'string') {
      return corsResponse(origin, 400, { error: 'resourceId is required' });
    }

    const resource = await queryOne<ResourceRow>(
      `SELECT id, org_id, user_id FROM community_resources WHERE id = $1`,
      [resourceId],
    );
    if (!resource) return corsResponse(origin, 404, { error: 'Resource not found' });

    // Authorization (OR of RLS DELETE policies, provenance 20260202125517):
    //   - platform admin (suite convention)
    //   - author of the resource
    //   - org admin of the resource's org
    let authorized = false;
    if (profile.is_platform_admin) {
      authorized = true;
    } else if (resource.user_id === profile.id) {
      authorized = true;
    } else if (await isOrgAdmin(profile.id, resource.org_id)) {
      authorized = true;
    }
    // Returning 404 here keeps an authenticated caller from distinguishing
    // "exists but I'm not allowed" from "doesn't exist" — prevents
    // cross-org enumeration of resource IDs.
    if (!authorized) return corsResponse(origin, 404, { error: 'Resource not found' });

    await query(`DELETE FROM community_resources WHERE id = $1`, [resourceId]);

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('resource-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
