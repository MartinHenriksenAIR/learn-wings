import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';
import { isOrgAdmin } from '../shared/profile';

export default endpoint('invitations', async ({ req, profile, reply, requirePlatformAdmin }) => {
  const body = await req.json() as { scope?: unknown; orgId?: unknown };
  const { scope, orgId } = body;

  if (scope !== 'org' && scope !== 'platform') {
    return reply(400, { error: 'scope must be "org" or "platform"' });
  }

  if (scope === 'org' && (typeof orgId !== 'string' || orgId === '')) {
    return reply(400, { error: 'orgId is required for scope=org' });
  }
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
    const orgIdStr = vOrgId as string;
    if (profile.is_platform_admin) {
      add('org_id', orgIdStr);
    } else if (await isOrgAdmin(profile.id, orgIdStr)) {
      add('org_id', orgIdStr);
      add('invited_by_user_id', profile.id);
    } else {
      return reply(403, { error: 'Forbidden' });
    }
  } else {
    requirePlatformAdmin();
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
