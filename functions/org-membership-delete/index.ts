import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
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

    const body = await req.json() as { id?: unknown };
    const { id } = body;

    // Validation first, lookup → authz, then DELETE.
    if (!id || typeof id !== 'string') {
      return corsResponse(origin, 400, { error: 'id is required' });
    }

    // Lookup first so we know which org to check authz against, and to give a
    // clean 404 for missing memberships (instead of relying on DELETE RETURNING).
    const existing = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM org_memberships WHERE id = $1`,
      [id],
    );
    if (!existing) return corsResponse(origin, 404, { error: 'Membership not found' });

    // Authorization: platform admin OR org admin of the membership's org.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 279-285 —
    // "Platform admins can do everything with memberships" (is_platform_admin())
    // + "Org admins can manage memberships in their org" (is_org_admin(org_id)).
    const authorized = profile.is_platform_admin || await isOrgAdmin(profile.id, existing.org_id);
    if (!authorized) return corsResponse(origin, 403, { error: 'Forbidden' });

    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM org_memberships WHERE id = $1 RETURNING id`,
      [id],
    );

    // TOCTOU: row vanished between SELECT and DELETE — treat as not found.
    if (!deleted) return corsResponse(origin, 404, { error: 'Membership not found' });
    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('org-membership-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
