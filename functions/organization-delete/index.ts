import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

interface OrgRow {
  id: string;
}

export default endpoint('organization-delete', async ({ req, profile, reply }) => {
    const body = await req.json() as { orgId?: unknown };
    const { orgId } = body;

    // Validation first (matches organization-update order), authz second.
    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    // Authorization: platform-admin-only.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 269-272 —
    // "Platform admins can do everything with orgs" was the only DELETE-capable policy.
    if (!profile.is_platform_admin) {
      return reply(403, { error: 'Forbidden' });
    }

    // DELETE ... RETURNING gives us the not-found signal (null) in one round trip.
    // Cascade deletes (org_memberships, invitations, org_settings, ai_champions,
    // community_*, ideas) handled by ON DELETE CASCADE per migration 20260127153401.
    const deleted = await queryOne<OrgRow>(
      `DELETE FROM organizations WHERE id = $1 RETURNING id`,
      [orgId],
    );
    if (!deleted) return reply(404, { error: 'Organization not found' });

    return reply(200, { ok: true });
});
