import { query, queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('organizations', async ({ req, profile, reply, requireActiveMember }) => {
    const { orgId } = await req.json() as { orgId?: string };

    if (orgId) {
      // Single org lookup
      await requireActiveMember(orgId);

      const organization = await queryOne(
        `SELECT id, name, slug, logo_url, seat_limit, created_at FROM organizations WHERE id = $1`,
        [orgId],
      );
      if (!organization) return reply(404, { error: 'Organization not found' });

      return reply(200, { organization });
    }

    // List orgs — correlated subquery for member_count is cleaner than a LEFT JOIN + GROUP BY
    // (no need to enumerate every column in GROUP BY, no JOIN-cardinality risk).
    // ::int cast: COUNT(*) returns BIGINT which the pg driver serializes as a string;
    // cast keeps callers seeing a number.
    if (profile.is_platform_admin) {
      const organizations = await query(
        `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.created_at,
          (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count
         FROM organizations o
         ORDER BY o.created_at DESC`,
      );
      return reply(200, { organizations });
    }

    const organizations = await query(
      `SELECT o.id, o.name, o.slug, o.logo_url, o.seat_limit, o.created_at,
        (SELECT COUNT(*)::int FROM org_memberships om2 WHERE om2.org_id = o.id AND om2.status = 'active') AS member_count
       FROM organizations o
       JOIN org_memberships om ON om.org_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'
       ORDER BY o.created_at DESC`,
      [profile.id],
    );
    return reply(200, { organizations });
});
