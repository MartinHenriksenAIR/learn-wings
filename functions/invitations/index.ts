import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { query } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { getProfile, isOrgAdmin } from '../shared/profile';

/**
 * Lists pending invitations. Replaces two Supabase RPCs:
 *   - get_org_invitations_safe(p_org_id)         — scope: 'org'
 *   - get_platform_invitations_safe(p_org_id?)   — scope: 'platform' (platform admins only)
 *
 * NEVER selects `token` or `token_hash` — both columns are security-sensitive and
 * the safe RPCs deliberately omit them. The endpoint preserves that contract.
 *
 * Authz parity:
 *   - scope='org': platform admin sees ALL pending invites in that org; org admins
 *     see only invitations they themselves created (matches RLS migration
 *     20260201171353_*.sql and the safe RPC).
 *   - scope='platform': platform-admin-only; orgId optional narrows the result.
 */
async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;

    const body = await req.json() as { scope?: unknown; orgId?: unknown };
    const { scope, orgId } = body;

    if (scope !== 'org' && scope !== 'platform') {
      return corsResponse(origin, 400, { error: 'scope must be "org" or "platform"' }) as HttpResponseInit;
    }

    if (scope === 'org' && (typeof orgId !== 'string' || orgId === '')) {
      return corsResponse(origin, 400, { error: 'orgId is required for scope=org' }) as HttpResponseInit;
    }
    // For scope='platform', orgId is optional; if present it must be a non-empty string.
    if (scope === 'platform' && orgId !== undefined && (typeof orgId !== 'string' || orgId === '')) {
      return corsResponse(origin, 400, { error: 'orgId must be a string' }) as HttpResponseInit;
    }

    const vOrgId = typeof orgId === 'string' && orgId !== '' ? orgId : undefined;

    const conditions: string[] = [`status = 'pending'`];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => {
      params.push(val);
      conditions.push(`${col} = $${params.length}`);
    };

    if (scope === 'org') {
      // vOrgId guaranteed non-empty by the validation above
      const orgIdStr = vOrgId as string;
      if (profile.is_platform_admin) {
        // Platform admin — see ALL pending invitations in this org
        add('org_id', orgIdStr);
      } else if (await isOrgAdmin(profile.id, orgIdStr)) {
        // Org admin of orgId — restricted to invitations they themselves sent (RLS parity)
        add('org_id', orgIdStr);
        add('invited_by_user_id', profile.id);
      } else {
        return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      }
    } else {
      // scope === 'platform' — platform-admin-only
      if (!profile.is_platform_admin) {
        return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;
      }
      if (vOrgId) add('org_id', vOrgId);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const invitations = await query(
      `SELECT id, org_id, email, role, status, expires_at, created_at, link_id,
              is_platform_admin_invite, invited_by_user_id,
              first_name, last_name, department
         FROM invitations${where}
        ORDER BY created_at DESC`,
      params,
    );

    return corsResponse(origin, 200, { invitations }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'Unknown error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('invitations', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
