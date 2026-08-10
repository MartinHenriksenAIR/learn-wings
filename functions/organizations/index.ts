import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('organizations', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: string };

  if (orgId) {
    await requireActiveMember(orgId);

    const organization = await queryOne<Record<string, unknown>>(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.entra_tid, o.entra_tid_label, o.allow_self_registration, o.created_at,
        (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count,
        (SELECT COUNT(*)::int FROM invitations i WHERE i.org_id = o.id AND i.status = 'pending') AS pending_invite_count
       FROM organizations o
       WHERE o.id = $1 AND o.kind = 'standard'`,
      [orgId],
    );
    // The `kind = 'standard'` filter also makes the Individuals placeholder (#354)
    // return no row here, so a fetch of its id 404s — it is never inspectable via this
    // endpoint. Solo learners get their currentOrg from user-context, not this fetch.
    if (!organization) return reply(404, { error: 'Organization not found' });

    // The SSO tenant binding (#353) is platform-admin config — org admins reach
    // this same fetch (OrgMembersTab), so strip it for non-platform-admins.
    // allow_self_registration (#356) is deliberately NOT stripped: it's org-owned
    // config an org admin sees and toggles for their own org.
    if (!profile.is_platform_admin) {
      delete organization.entra_tid;
      delete organization.entra_tid_label;
    }

    return reply(200, { organization });
  }

  // List orgs — correlated subquery for member_count is cleaner than a LEFT JOIN + GROUP BY
  // (no need to enumerate every column in GROUP BY, no JOIN-cardinality risk).
  // ::int cast: COUNT(*) returns BIGINT which the pg driver serializes as a string;
  // cast keeps callers seeing a number.
  if (profile.is_platform_admin) {
    const organizations = await query(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.entra_tid, o.entra_tid_label, o.allow_self_registration, o.created_at,
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
