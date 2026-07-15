import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

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
export default endpoint('invitations', async ({ req, profile, reply }) => {
    const body = await req.json() as { scope?: unknown; orgId?: unknown };
    const { scope, orgId } = body;

    if (scope !== 'org' && scope !== 'platform') {
      return reply(400, { error: 'scope must be "org" or "platform"' });
    }

    if (scope === 'org' && (typeof orgId !== 'string' || orgId === '')) {
      return reply(400, { error: 'orgId is required for scope=org' });
    }
    // For scope='platform', orgId is optional; if present it must be a non-empty string.
    if (scope === 'platform' && orgId !== undefined && (typeof orgId !== 'string' || orgId === '')) {
      return reply(400, { error: 'orgId must be a string' });
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
        return reply(403, { error: 'Forbidden' });
      }
    } else {
      // scope === 'platform' — platform-admin-only
      if (!profile.is_platform_admin) {
        return reply(403, { error: 'Forbidden' });
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

    return reply(200, { invitations });
});
