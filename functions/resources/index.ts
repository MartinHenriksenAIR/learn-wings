import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';
import { RESOURCE_PROFILE_PROJECTION } from '../shared/resources';

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as {
      orgId?: unknown;
      search?: unknown;
      resource_type?: unknown;
      tags?: unknown;
    };

    const { orgId, search, resource_type, tags } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }
    if (search !== undefined && typeof search !== 'string') {
      return corsResponse(origin, 400, { error: 'search must be a string' }) as HttpResponseInit;
    }
    if (resource_type !== undefined && typeof resource_type !== 'string') {
      return corsResponse(origin, 400, { error: 'resource_type must be a string' }) as HttpResponseInit;
    }
    if (tags !== undefined && !isStringArray(tags)) {
      return corsResponse(origin, 400, { error: 'tags must be an array of strings' }) as HttpResponseInit;
    }

    // Authorization: platform admin OR active member of the org
    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    params.push(orgId);
    conditions.push(`r.org_id = $${params.length}`);

    if (resource_type) {
      params.push(resource_type);
      conditions.push(`r.resource_type = $${params.length}`);
    }

    if (tags && tags.length > 0) {
      params.push(tags);
      conditions.push(`r.tags && $${params.length}::text[]`);
    }

    if (search) {
      // Escape LIKE metacharacters so user input like "100%" or "snake_case"
      // is treated as a literal substring rather than a wildcard.
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      params.push(`%${escaped}%`);
      const n = params.length;
      conditions.push(`(r.title ILIKE $${n} OR r.description ILIKE $${n})`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const resources = await query(`
      SELECT r.*,
        ${RESOURCE_PROFILE_PROJECTION}
      FROM community_resources r
      LEFT JOIN profiles pr ON pr.id = r.user_id
      ${where}
      ORDER BY r.is_pinned DESC, r.created_at DESC
    `, params);

    // Distinct tags for the org, regardless of search/type/tag filters — powers the tag dropdown.
    const tagsRow = await queryOne<{ all_tags: string[] }>(
      `SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), '{}'::text[]) AS all_tags
       FROM community_resources r, unnest(r.tags) AS t
       WHERE r.org_id = $1`,
      [orgId],
    );

    return corsResponse(origin, 200, { resources, allTags: tagsRow?.all_tags ?? [] }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('resources', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
