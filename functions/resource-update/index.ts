import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const RESOURCE_TYPES = ['link', 'document', 'template', 'guide'];
const ALLOWED_UPDATE_FIELDS = new Set([
  'title', 'description', 'resource_type', 'url', 'tags', 'is_pinned',
]);

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

    const body = await req.json() as { resourceId?: unknown; updates?: unknown };
    const { resourceId, updates } = body;

    if (!resourceId || typeof resourceId !== 'string') {
      return corsResponse(origin, 400, { error: 'resourceId is required' }) as HttpResponseInit;
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return corsResponse(origin, 400, { error: 'updates must be an object' }) as HttpResponseInit;
    }

    const updatesObj = updates as Record<string, unknown>;
    const updateKeys = Object.keys(updatesObj).filter((k) => ALLOWED_UPDATE_FIELDS.has(k));
    if (updateKeys.length === 0) {
      return corsResponse(origin, 400, { error: 'No valid update fields provided' }) as HttpResponseInit;
    }

    for (const key of updateKeys) {
      const v = updatesObj[key];
      if (key === 'tags') {
        if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) {
          return corsResponse(origin, 400, { error: 'tags must be an array of strings' }) as HttpResponseInit;
        }
      } else if (key === 'is_pinned') {
        if (typeof v !== 'boolean') {
          return corsResponse(origin, 400, { error: 'is_pinned must be a boolean' }) as HttpResponseInit;
        }
      } else if (key === 'resource_type') {
        if (typeof v !== 'string' || !RESOURCE_TYPES.includes(v)) {
          return corsResponse(origin, 400, {
            error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}`,
          }) as HttpResponseInit;
        }
      } else {
        // title, description, url — string or null
        if (v !== null && typeof v !== 'string') {
          return corsResponse(origin, 400, { error: `${key} must be a string` }) as HttpResponseInit;
        }
      }
    }

    const resource = await queryOne<ResourceRow>(
      `SELECT id, org_id, user_id FROM community_resources WHERE id = $1`,
      [resourceId],
    );
    if (!resource) return corsResponse(origin, 404, { error: 'Resource not found' }) as HttpResponseInit;

    // Authorization (OR of RLS policies, provenance 20260202125517):
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
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // Dynamic UPDATE over the whitelisted keys + return shape with embedded profile (CTE).
    const params: unknown[] = [];
    const setClauses = updateKeys.map((key) => {
      params.push(updatesObj[key]);
      return `${key} = $${params.length}`;
    });
    params.push(resourceId);
    const idIndex = params.length;

    const updated = await queryOne(
      `WITH upd AS (
        UPDATE community_resources SET ${setClauses.join(', ')}
        WHERE id = $${idIndex}
        RETURNING *
      )
      SELECT upd.*,
        CASE WHEN pr.id IS NULL THEN NULL ELSE
          json_build_object('id', pr.id, 'full_name', pr.full_name, 'department', pr.department)
        END AS profile
      FROM upd
      LEFT JOIN profiles pr ON pr.id = upd.user_id`,
      params,
    );

    return corsResponse(origin, 200, { resource: updated }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('resource-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
