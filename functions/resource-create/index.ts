import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isActiveMember } from '../shared/profile';
import { RESOURCE_PROFILE_PROJECTION } from '../shared/resources';

// Mirrors RESOURCE_TYPES in src/lib/resources-api.ts. No DB CHECK constraint exists
// (the column is plain TEXT DEFAULT 'link'); validating here keeps types consistent
// with the form's <Select> options.
const RESOURCE_TYPES = ['link', 'document', 'template', 'guide'];

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as Record<string, unknown>;
    const { orgId, title, description, resource_type, url, tags } = body;

    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }
    if (!title || typeof title !== 'string') {
      return corsResponse(origin, 400, { error: 'title is required' }) as HttpResponseInit;
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return corsResponse(origin, 400, { error: 'description must be a string' }) as HttpResponseInit;
    }
    if (resource_type !== undefined && (typeof resource_type !== 'string' || !RESOURCE_TYPES.includes(resource_type))) {
      return corsResponse(origin, 400, {
        error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}`,
      }) as HttpResponseInit;
    }
    if (url !== undefined && url !== null && typeof url !== 'string') {
      return corsResponse(origin, 400, { error: 'url must be a string' }) as HttpResponseInit;
    }
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string'))) {
      return corsResponse(origin, 400, { error: 'tags must be an array of strings' }) as HttpResponseInit;
    }

    // Authorization: platform admin OR active member of the org
    const authorized = profile.is_platform_admin || await isActiveMember(profile.id, orgId);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // INSERT + LEFT JOIN profiles in one round trip so the response matches the
    // original lib's .select(`*, profile:profiles!fk(...)`) shape.
    // user_id is ALWAYS profile.id (never client-supplied).
    const resource = await queryOne(
      `WITH ins AS (
        INSERT INTO community_resources
          (org_id, user_id, title, description, resource_type, url, tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      )
      SELECT ins.*,
        ${RESOURCE_PROFILE_PROJECTION}
      FROM ins
      LEFT JOIN profiles pr ON pr.id = ins.user_id`,
      [
        orgId,
        profile.id,
        title,
        (description as string | null | undefined) ?? null,
        (resource_type as string | undefined) ?? 'link',
        (url as string | null | undefined) ?? null,
        (tags as string[] | undefined) ?? [],
      ],
    );

    return corsResponse(origin, 200, { resource }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('resource-create', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
