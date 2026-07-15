import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

/**
 * Updates a single invitation. Replaces the frontend's "cancel pending invitation"
 * flow which did:
 *   supabase.from('invitations').update({ status: 'expired' }).eq('id', invitationId)
 *
 * The schema is kept slightly generic (status field on the body) but for now we
 * ACCEPT ONLY `status: 'expired'`; other statuses are rejected with 400. The
 * pending → accepted transition is handled inside the signup/accept flow, not
 * via this admin-facing endpoint.
 *
 * NEVER selects/returns `token` or `token_hash` — same column projection as
 * invitation-create / invitations LIST. Those columns are security-sensitive.
 */
export default endpoint('invitation-update', async ({ req, reply, requireOrgAdmin }) => {
    const body = await req.json() as { id?: unknown; status?: unknown };
    const { id, status } = body;

    // Validation first, lookup → authz, then UPDATE (mirrors org-membership-update).
    if (!id || typeof id !== 'string') {
      return reply(400, { error: 'id is required' });
    }
    if (status !== 'expired') {
      return reply(400, { error: "status must be 'expired'" });
    }

    // Lookup first so we know which org to check authz against, and to give a
    // clean 404 for missing invitations (instead of relying on UPDATE RETURNING).
    const existing = await queryOne<{ org_id: string }>(
      `SELECT org_id FROM invitations WHERE id = $1`,
      [id],
    );
    if (!existing) return reply(404, { error: 'Invitation not found' });

    // Authorization: platform admin OR org admin of the invitation's org.
    // RLS provenance:
    //   - supabase/migrations/20260127203144_*.sql lines 42-44 —
    //     "Org admins can update invitations in their org" (USING is_org_admin(org_id))
    //   - supabase/migrations/20260128234638_*.sql lines 29-32 —
    //     "Platform admins can update invitations" (USING is_platform_admin())
    await requireOrgAdmin(existing.org_id);

    const invitation = await queryOne(
      `UPDATE invitations SET status = 'expired'
       WHERE id = $1
       RETURNING id, org_id, email, role, status, expires_at, created_at, link_id,
                 is_platform_admin_invite, invited_by_user_id, first_name, last_name, department`,
      [id],
    );

    // TOCTOU: row vanished between SELECT and UPDATE — treat as not found.
    if (!invitation) return reply(404, { error: 'Invitation not found' });
    return reply(200, { invitation });
});
