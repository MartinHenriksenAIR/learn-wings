import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-membership-delete', async ({ req, reply, requireOrgAdmin }) => {
    const body = await req.json() as { id?: unknown };
    const { id } = body;

    // Validation first, lookup → authz, then DELETE.
    if (!id || typeof id !== 'string') {
      return reply(400, { error: 'id is required' });
    }

    // Lookup first so we know which org to check authz against, and to give a
    // clean 404 for missing memberships (instead of relying on DELETE RETURNING).
    const existing = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM org_memberships WHERE id = $1`,
      [id],
    );
    if (!existing) return reply(404, { error: 'Membership not found' });

    // Authorization: platform admin OR org admin of the membership's org.
    // RLS provenance: supabase/migrations/20260127153401_*.sql lines 279-285 —
    // "Platform admins can do everything with memberships" (is_platform_admin())
    // + "Org admins can manage memberships in their org" (is_org_admin(org_id)).
    await requireOrgAdmin(existing.org_id);

    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM org_memberships WHERE id = $1 RETURNING id`,
      [id],
    );

    // TOCTOU: row vanished between SELECT and DELETE — treat as not found.
    if (!deleted) return reply(404, { error: 'Membership not found' });
    return reply(200, { ok: true });
});
