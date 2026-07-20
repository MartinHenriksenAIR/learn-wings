import { withTransaction } from '../shared/db';
import { adminEndpoint } from '../shared/endpoint';

export default adminEndpoint('seat-request-fulfill', async ({ req, profile, reply }) => {
  const { id } = await req.json() as { id?: unknown };
  if (!id || typeof id !== 'string') return reply(400, { error: 'id is required' });

  const result = await withTransaction(async (client) => {
    const reqRes = await client.query<{ org_id: string; status: string; additional_seats: number }>(
      `SELECT org_id, status, additional_seats FROM seat_requests WHERE id = $1 FOR UPDATE`, [id],
    );
    const sr = reqRes.rows[0];
    if (!sr) return { kind: 'not_found' as const };
    if (sr.status !== 'pending') return { kind: 'not_pending' as const };

    const orgRes = await client.query<{ seat_limit: number | null }>(
      `SELECT seat_limit FROM organizations WHERE id = $1 FOR UPDATE`, [sr.org_id],
    );
    const org = orgRes.rows[0];
    if (!org) return { kind: 'not_found' as const };
    if (org.seat_limit === null) return { kind: 'unlimited' as const };

    const bump = await client.query<{ seat_limit: number }>(
      `UPDATE organizations SET seat_limit = seat_limit + $2 WHERE id = $1 RETURNING seat_limit`,
      [sr.org_id, sr.additional_seats],
    );
    const updated = await client.query(
      `UPDATE seat_requests
          SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by_user_id = $2
        WHERE id = $1
        RETURNING id, org_id, requested_by_user_id, additional_seats,
                  unit_price_snapshot::float8 AS unit_price_snapshot, currency, status, created_at, fulfilled_at`,
      [id, profile.id],
    );
    return { kind: 'fulfilled' as const, request: updated.rows[0], seatLimit: bump.rows[0].seat_limit };
  });

  if (result.kind === 'not_found') return reply(404, { error: 'Seat request not found' });
  if (result.kind === 'not_pending') return reply(409, { error: 'Seat request is not pending', code: 'NOT_PENDING' });
  if (result.kind === 'unlimited') return reply(409, { error: 'Organization has no seat limit', code: 'ORG_UNLIMITED' });
  return reply(200, { request: result.request, seatLimit: result.seatLimit });
});
