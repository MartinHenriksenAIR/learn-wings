import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('organizations', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: string };

  if (orgId) {
    await requireActiveMember(orgId);

    const organization = await queryOne<Record<string, unknown>>(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.entra_tid, o.entra_tid_label, o.allow_self_registration, o.default_member_language, o.created_at,
        (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count,
        (SELECT COUNT(*)::int FROM invitations i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_invite_count
       FROM organizations o
       WHERE o.id = $1 AND o.kind = 'standard'`,
      [orgId],
    );
    if (!organization) return reply(404, { error: 'Organization not found' });

    if (!profile.is_platform_admin) {
      delete organization.entra_tid;
      delete organization.entra_tid_label;
    }

    return reply(200, { organization });
  }

  if (profile.is_platform_admin) {
    const organizations = await query(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.entra_tid, o.entra_tid_label, o.allow_self_registration, o.default_member_language, o.created_at,
        (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count,
        (SELECT COUNT(*)::int FROM invitations i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_invite_count
       FROM organizations o
       WHERE o.kind = 'standard'
       ORDER BY o.created_at DESC`,
    );
    return reply(200, { organizations });
  }

  const organizations = await query(
    `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.created_at,
      (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count,
      (SELECT COUNT(*)::int FROM invitations i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_invite_count
     FROM organizations o
     JOIN org_memberships om ON om.org_id = o.id
     WHERE om.user_id = $1 AND om.status = 'active' AND o.kind = 'standard'
     ORDER BY o.created_at DESC`,
    [profile.id],
  );
  return reply(200, { organizations });
});
