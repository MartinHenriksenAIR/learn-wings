import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('platform-admin-update', async ({ req, reply }) => {
  const { userId, grant } = (await req.json()) as { userId?: unknown; grant?: unknown };
  if (!userId || typeof userId !== 'string') return reply(400, { error: 'userId is required' });
  if (typeof grant !== 'boolean') return reply(400, { error: 'grant must be a boolean' });

  const result = await withTransaction(async (client) => {
    const admins = await client.query<{ id: string }>(
      `SELECT id FROM profiles WHERE is_platform_admin = true FOR UPDATE`,
    );
    const adminIds = admins.rows.map((r) => r.id);

    const target = await client.query<{ id: string }>(
      `SELECT id FROM profiles WHERE id = $1`,
      [userId],
    );
    if (!target.rows[0]) return { kind: 'not_found' as const };

    if (grant) {
      await client.query(`UPDATE profiles SET is_platform_admin = true WHERE id = $1`, [userId]);
      return { kind: 'granted' as const };
    }

    const isCurrentlyAdmin = adminIds.includes(userId);
    if (isCurrentlyAdmin && adminIds.length <= 1) return { kind: 'last_admin' as const };

    await client.query(`UPDATE profiles SET is_platform_admin = false WHERE id = $1`, [userId]);
    return { kind: 'revoked' as const };
  });

  if (result.kind === 'not_found') return reply(404, { error: 'User not found' });
  if (result.kind === 'last_admin') {
    return reply(409, { error: 'Cannot remove the last platform admin', code: 'LAST_ADMIN' });
  }
  return reply(200, { ok: true });
});
