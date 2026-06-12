import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

interface OrgRow {
  id: string;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });

    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    // Validation first (matches organization-update order), authz second.
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' });
    }

    // Authorization: platform-admin-only.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-272 —
    // "Platform admins can do everything with orgs" was the only DELETE-capable policy.
    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' });
    }

    // DELETE ... RETURNING gives us the not-found signal (null) in one round trip.
    // Cascade deletes (org_memberships, invitations, org_settings, ai_champions,
    // community_*, ideas) handled by ON DELETE CASCADE per migration 20260127153401.
    const deleted = await queryOne<OrgRow>(
      `DELETE FROM organizations WHERE id = $1 RETURNING id`,
      [orgId],
    );
    if (!deleted) return corsResponse(origin, 404, { error: 'Organization not found' });

    return corsResponse(origin, 200, { ok: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

export default handler;
app.http('organization-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
