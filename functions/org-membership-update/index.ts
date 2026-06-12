import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

const ALLOWED_ROLES = new Set(['org_admin', 'learner']);
const ALLOWED_STATUSES = new Set(['active', 'invited', 'disabled']);

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { id?: unknown; role?: unknown; status?: unknown };
    const { id, role, status } = body;

    // Validation first, lookup → authz, then UPDATE.
    if (!id || typeof id !== 'string') {
      return corsResponse(origin, 400, { error: 'id is required' }) as HttpResponseInit;
    }
    if (role === undefined && status === undefined) {
      return corsResponse(origin, 400, { error: 'No update fields provided' }) as HttpResponseInit;
    }
    if (role !== undefined && (typeof role !== 'string' || !ALLOWED_ROLES.has(role))) {
      return corsResponse(origin, 400, { error: 'role must be one of: org_admin, learner' }) as HttpResponseInit;
    }
    if (status !== undefined && (typeof status !== 'string' || !ALLOWED_STATUSES.has(status))) {
      return corsResponse(origin, 400, { error: 'status must be one of: active, invited, disabled' }) as HttpResponseInit;
    }

    // Lookup first so we know which org to check authz against, and to give a
    // clean 404 for missing memberships (instead of relying on UPDATE RETURNING).
    const existing = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM org_memberships WHERE id = $1`,
      [id],
    );
    if (!existing) return corsResponse(origin, 404, { error: 'Membership not found' }) as HttpResponseInit;

    // Authorization: platform admin OR org admin of the membership's org.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 279-285 —
    // "Platform admins can do everything with memberships" (is_platform_admin())
    // + "Org admins can manage memberships in their org" (is_org_admin(org_id)).
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, existing.org_id);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    // Dynamic UPDATE built from supplied keys only (mirrors organization-update).
    const params: unknown[] = [];
    const setClauses: string[] = [];
    if (role !== undefined) {
      params.push(role);
      setClauses.push(`role = $${params.length}`);
    }
    if (status !== undefined) {
      params.push(status);
      setClauses.push(`status = $${params.length}`);
    }
    params.push(id);
    const idIndex = params.length;

    const membership = await queryOne(
      `UPDATE org_memberships SET ${setClauses.join(', ')}
       WHERE id = $${idIndex}
       RETURNING id, org_id, user_id, role, status, created_at`,
      params,
    );

    // TOCTOU: row vanished between SELECT and UPDATE — treat as not found.
    if (!membership) return corsResponse(origin, 404, { error: 'Membership not found' }) as HttpResponseInit;
    return corsResponse(origin, 200, { membership }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('org-membership-update', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
