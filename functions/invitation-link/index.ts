import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('invitation-link', async ({ req, reply, requireOrgAdmin }) => {
    // 3. Validate orgId
    const { orgId } = await req.json() as { orgId?: string };
    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    // 4. Authorize: platform admin OR org admin
    await requireOrgAdmin(orgId);

    // 5. Query the real table
    const row = await queryOne<{ link_id: string }>(
      `SELECT link_id
         FROM invitations
        WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW() AND link_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId],
    );

    return reply(200, { linkId: row?.link_id ?? null });
});
