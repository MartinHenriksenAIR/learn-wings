import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('ai-champion-delete', async ({ req, reply, requireOrgAdmin }) => {
    const body = await req.json() as { orgId?: unknown; userId?: unknown };
    const { orgId, userId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return reply(400, { error: 'userId is required' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260202125422_*.sql —
    // "Platform admins can manage all AI champions" + "Org admins can manage AI champions" (FOR ALL).
    // No lookup-then-404 (unlike org-membership-delete): orgId is client-supplied and scopes the
    // DELETE directly, and Supabase zero-row deletes reported success — idempotent 200 is parity.
    await requireOrgAdmin(orgId);

    // Blind delete — idempotent (Supabase zero-row-delete parity); see idea-vote-remove.
    await query(
      `DELETE FROM ai_champions WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId],
    );

    return reply(200, { ok: true });
});
