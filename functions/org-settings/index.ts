import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('org-settings', async ({ req, reply, requireActiveMember }) => {
    const { orgId } = await req.json() as { orgId?: unknown };

    if (!orgId || typeof orgId !== 'string') {
      return reply(400, { error: 'orgId is required' });
    }

    await requireActiveMember(orgId);

    // A missing row is not a 404 — frontend treats null as "no overrides" (parity with Supabase .maybeSingle()).
    const settings = await queryOne(
      `SELECT org_id, features FROM org_settings WHERE org_id = $1`,
      [orgId],
    );

    return reply(200, { settings });
});
