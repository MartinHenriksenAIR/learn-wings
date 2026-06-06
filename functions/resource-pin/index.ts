import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

interface ResourceRow {
  id: string;
  org_id: string;
  user_id: string;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { resourceId?: unknown; pinned?: unknown };
    const { resourceId, pinned } = body;

    if (!resourceId || typeof resourceId !== 'string') {
      return corsResponse(origin, 400, { error: 'resourceId is required' }) as HttpResponseInit;
    }
    if (typeof pinned !== 'boolean') {
      return corsResponse(origin, 400, { error: 'pinned must be a boolean' }) as HttpResponseInit;
    }

    const resource = await queryOne<ResourceRow>(
      `SELECT id, org_id, user_id FROM community_resources WHERE id = $1`,
      [resourceId],
    );
    if (!resource) return corsResponse(origin, 404, { error: 'Resource not found' }) as HttpResponseInit;

    // Authorization mirrors resource-update (RLS UPDATE policies, provenance 20260202125517):
    // platform admin OR org admin OR author. UI surfaces the pin action only to admins,
    // but the server matches the RLS contract — not stricter.
    let authorized = false;
    if (profile.is_platform_admin) {
      authorized = true;
    } else if (resource.user_id === profile.id) {
      authorized = true;
    } else if (await isOrgAdmin(profile.id, resource.org_id)) {
      authorized = true;
    }
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const updated = await queryOne(
      `WITH upd AS (
        UPDATE community_resources SET is_pinned = $1 WHERE id = $2 RETURNING *
      )
      SELECT upd.*,
        CASE WHEN pr.id IS NULL THEN NULL ELSE
          json_build_object('id', pr.id, 'full_name', pr.full_name, 'department', pr.department)
        END AS profile
      FROM upd
      LEFT JOIN profiles pr ON pr.id = upd.user_id`,
      [pinned, resourceId],
    );

    return corsResponse(origin, 200, { resource: updated }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('resource-pin', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
