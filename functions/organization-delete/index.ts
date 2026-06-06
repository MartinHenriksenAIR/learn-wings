import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query, queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile } from '../shared/profile';

interface OrgRow {
  id: string;
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    // Validation first (matches organization-update order), authz second.
    if (!orgId || typeof orgId !== 'string') {
      return corsResponse(origin, 400, { error: 'orgId is required' }) as HttpResponseInit;
    }

    // Authorization: platform-admin-only.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-272 —
    // "Platform admins can do everything with orgs" was the only DELETE-capable policy.
    if (!profile.is_platform_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
    }

    // Existence check — distinguish "not found" from "delete succeeded with 0 rows".
    const existing = await queryOne<OrgRow>(
      `SELECT id FROM organizations WHERE id = $1`,
      [orgId],
    );
    if (!existing) return corsResponse(origin, 404, { error: 'Organization not found' }) as HttpResponseInit;

    // Cascade deletes (org_memberships, invitations, org_settings, ai_champions,
    // community_*, ideas) handled by ON DELETE CASCADE per migration 20260127153401.
    await query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    return corsResponse(origin, 200, { ok: true }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('organization-delete', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
