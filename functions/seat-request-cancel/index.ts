import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('seat-request-cancel', async ({ req, reply, requireOrgAdmin }) => {
  const { id } = await req.json() as { id?: unknown };
  if (!id || typeof id !== 'string') return reply(400, { error: 'id is required' });

  const existing = await queryOne<{ org_id: string; status: string }>(
    `SELECT org_id, status FROM seat_requests WHERE id = $1`, [id],
  );
  if (!existing) return reply(404, { error: 'Seat request not found' });

  await requireOrgAdmin(existing.org_id);

  const updated = await queryOne(
    `UPDATE seat_requests
        SET status = 'cancelled', cancelled_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, org_id, additional_seats, unit_price_snapshot::float8 AS unit_price_snapshot,
                currency, status, created_at, cancelled_at`,
    [id],
  );
  if (!updated) return reply(409, { error: 'Seat request is not pending', code: 'NOT_PENDING' });

  return reply(200, { request: updated });
});
