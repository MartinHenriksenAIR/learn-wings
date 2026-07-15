import { queryOne, isUniqueViolation } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('ai-champion-create', async ({ req, profile, reply, requireOrgAdmin }) => {
    const body = await req.json() as { orgId?: unknown; userId?: unknown };
    const { orgId, userId } = body;

    // Validation first, authz second, db third (mirrors org-membership-create).
    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }
    if (!userId || typeof userId !== 'string') {
      return reply(400, { error: 'userId is required' });
    }

    // Authorization: platform admin OR org admin of the target org.
    // RLS provenance: supabase/migrations/20260202125422_*.sql —
    // "Platform admins can manage all AI champions" (is_platform_admin())
    // + "Org admins can manage AI champions" (is_org_admin(org_id)), both FOR ALL.
    await requireOrgAdmin(orgId);

    try {
      // assigned_by is the CALLER's profile id, server-derived — never client-supplied
      // (the old client sent the Entra OID; issue #11 audit item).
      const champion = await queryOne(
        `INSERT INTO ai_champions (user_id, org_id, assigned_by)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, org_id, assigned_by, assigned_at`,
        [userId, orgId, profile.id],
      );
      return reply(200, { champion });
    } catch (dbErr: unknown) {
      if (isUniqueViolation(dbErr)) {
        return reply(409, { error: 'User is already an AI Champion in this organization' });
      }
      if ((dbErr as { code?: string })?.code === '23503') {
        return reply(404, { error: 'Organization or user not found' });
      }
      throw dbErr;
    }
});
